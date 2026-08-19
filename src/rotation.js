/* SillyTavern-Roulette — AGPL-3.0
 *
 * Pure rotation logic. No SillyTavern imports. All functions take state and
 * return state (or computed values), so they're trivially unit-testable and
 * deterministic when given a seeded RNG.
 *
 * Data shapes (see CLAUDE.md for the canonical spec):
 *
 *   Slot = {
 *     id, profileName,
 *     countMode: 'fixed' | 'range',
 *     fixedCount, minCount, maxCount,   // sequential mode
 *     weight                            // weighted-random mode (default 1)
 *   }
 *   Queue = {
 *     id, name,
 *     mode: 'sequential' | 'weighted-random',
 *     slots: Slot[],
 *     noRepeatInRow,                    // weighted-random
 *     weightedRunCount: { mode, fixed, min, max }
 *   }
 *   ChatRouletteState = {
 *     activeQueueId, currentSlotId, responsesRemaining, responsesAllotted,
 *     lastSwitchMessageId, history, manuallyOverridden,
 *     autoBindHandled
 *   }
 */

/**
 * True iff a generation/message of this type should advance the rotation
 * counter (and trigger a profile switch on GENERATION_STARTED).
 *
 * Strict whitelist: only a normal user-triggered generation counts.
 * SillyTavern passes no type for those (some paths label them 'normal').
 * Everything else — 'swipe', 'regenerate', 'continue', 'append',
 * 'appendFinal', 'impersonate', 'quiet', 'first_message', plus types that
 * never reach GENERATION_STARTED at all like 'command' (/sendas) and
 * 'extension' (extension-inserted messages), and any type SillyTavern adds
 * in the future — must not consume rotation slots, so unknown types fail
 * closed.
 *
 * @param {string|undefined} type generation type from MESSAGE_RECEIVED / GENERATION_STARTED
 * @returns {boolean}
 */
export function isCountableGeneration(type) {
    return type === undefined || type === null || type === 'normal';
}

/**
 * Roll an integer in [min, max] inclusive.
 *
 * @param {number} min
 * @param {number} max
 * @param {() => number} rng
 * @returns {number}
 */
export function rollInRange(min, max, rng = Math.random) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/**
 * Compute how many responses a slot should run for, given the queue mode
 * and the slot/queue count config.
 *
 * @param {object} slot
 * @param {object} queue
 * @param {() => number} rng
 * @returns {number} responses (>= 1)
 */
export function rollSlotResponses(slot, queue, rng = Math.random) {
    if (queue.mode === 'sequential') {
        if (slot.countMode === 'fixed') {
            return Math.max(1, slot.fixedCount | 0);
        }
        const min = Math.max(1, slot.minCount | 0);
        const max = Math.max(min, slot.maxCount | 0);
        return rollInRange(min, max, rng);
    }
    // weighted-random — read from queue.weightedRunCount, default 1.
    const cfg = queue.weightedRunCount ?? { mode: 'fixed', fixed: 1 };
    if (cfg.mode === 'fixed') {
        return Math.max(1, (cfg.fixed ?? 1) | 0);
    }
    const min = Math.max(1, (cfg.min ?? 1) | 0);
    const max = Math.max(min, (cfg.max ?? min) | 0);
    return rollInRange(min, max, rng);
}

/**
 * Pick a slot index by weighted random selection. Slots with weight <= 0
 * are excluded. Indices in `excludeIndices` are excluded too.
 *
 * Returns -1 if no eligible slot exists.
 *
 * @param {Array<{weight?: number}>} slots
 * @param {number[]} excludeIndices
 * @param {() => number} rng
 * @returns {number} index in `slots`, or -1
 */
export function pickWeightedIndex(slots, excludeIndices = [], rng = Math.random) {
    const eligible = [];
    let total = 0;
    for (let i = 0; i < slots.length; i++) {
        if (excludeIndices.includes(i)) continue;
        const w = Math.max(0, Number(slots[i].weight ?? 1));
        if (w <= 0) continue;
        eligible.push({ i, w });
        total += w;
    }
    if (eligible.length === 0 || total <= 0) return -1;
    let r = rng() * total;
    for (const e of eligible) {
        if (r < e.w) return e.i;
        r -= e.w;
    }
    return eligible[eligible.length - 1].i;
}

/**
 * Pick the starting slot when activating a queue.
 *
 * @param {object} queue
 * @param {() => number} rng
 * @returns {{slotId: string, slotIndex: number, responses: number} | null}
 */
export function pickInitialSlot(queue, rng = Math.random) {
    if (!queue || !Array.isArray(queue.slots) || queue.slots.length === 0) {
        return null;
    }
    if (queue.mode === 'sequential') {
        const slot = queue.slots[0];
        return {
            slotId: slot.id,
            slotIndex: 0,
            responses: rollSlotResponses(slot, queue, rng),
        };
    }
    const idx = pickWeightedIndex(queue.slots, [], rng);
    if (idx < 0) return null;
    const slot = queue.slots[idx];
    return {
        slotId: slot.id,
        slotIndex: idx,
        responses: rollSlotResponses(slot, queue, rng),
    };
}

/**
 * Compute the next slot when the current one's counter has run out.
 *
 * For sequential mode, walks forward (with wrap). `excludeIndices` lets
 * the error path skip a failing slot.
 *
 * For weighted-random, re-rolls. Honours `noRepeatInRow` by excluding the
 * current slot. `excludeIndices` is added to that exclude set.
 *
 * Returns null if no eligible slot exists.
 *
 * @param {object} queue
 * @param {number} currentIndex slot index that just finished (-1 if none)
 * @param {number[]} excludeIndices indices to skip (e.g. failed-switch slots)
 * @param {() => number} rng
 * @returns {{slotId: string, slotIndex: number, responses: number} | null}
 */
export function advanceSlot(queue, currentIndex, excludeIndices = [], rng = Math.random) {
    if (!queue || !Array.isArray(queue.slots) || queue.slots.length === 0) {
        return null;
    }
    if (queue.mode === 'sequential') {
        const n = queue.slots.length;
        const exclude = new Set(excludeIndices);
        for (let step = 1; step <= n; step++) {
            const next = ((currentIndex < 0 ? -1 : currentIndex) + step + n) % n;
            if (!exclude.has(next)) {
                const slot = queue.slots[next];
                return {
                    slotId: slot.id,
                    slotIndex: next,
                    responses: rollSlotResponses(slot, queue, rng),
                };
            }
        }
        return null;
    }
    // weighted-random
    const exclude = [...excludeIndices];
    if (queue.noRepeatInRow && currentIndex >= 0 && queue.slots.length > 1) {
        exclude.push(currentIndex);
    }
    const idx = pickWeightedIndex(queue.slots, exclude, rng);
    if (idx < 0) return null;
    const slot = queue.slots[idx];
    return {
        slotId: slot.id,
        slotIndex: idx,
        responses: rollSlotResponses(slot, queue, rng),
    };
}

/**
 * Locate a slot's index in the queue by id.
 *
 * @returns {number} -1 if not found
 */
export function indexOfSlot(queue, slotId) {
    if (!queue || !Array.isArray(queue.slots)) return -1;
    return queue.slots.findIndex(s => s.id === slotId);
}

/**
 * Initial state for a new chat (rotation off).
 *
 * @returns {object}
 */
export function emptyState() {
    return {
        activeQueueId: null,
        currentSlotId: null,
        responsesRemaining: 0,
        responsesAllotted: 0,
        lastSwitchMessageId: null,
        history: [],
        manuallyOverridden: false,
        // True once this chat has settled the question of whether its
        // character's bound queue should auto-start. Prevents a deliberately
        // stopped rotation from resurrecting every time the chat is reopened.
        autoBindHandled: false,
    };
}

/**
 * Append a history entry, capping history length to avoid metadata bloat.
 *
 * @param {object} state
 * @param {{messageId: number, profileName: string, timestamp: number}} entry
 * @param {number} maxEntries
 * @returns {object} new state
 */
export function appendHistory(state, entry, maxEntries = 500) {
    const history = state.history.concat([entry]);
    if (history.length > maxEntries) {
        history.splice(0, history.length - maxEntries);
    }
    return { ...state, history };
}

/**
 * Validate a queue. Returns an array of human-readable error messages
 * (empty if valid).
 *
 * @param {object} queue
 * @param {string[]} availableProfileNames optional list to validate slots
 *   against. If omitted, profile-existence is not checked.
 * @returns {string[]}
 */
export function validateQueue(queue, availableProfileNames = null) {
    const errors = [];
    if (!queue || typeof queue !== 'object') {
        errors.push('Queue is missing or not an object.');
        return errors;
    }
    if (!queue.name || typeof queue.name !== 'string') {
        errors.push('Queue must have a non-empty name.');
    }
    if (queue.mode !== 'sequential' && queue.mode !== 'weighted-random') {
        errors.push(`Queue mode must be "sequential" or "weighted-random" (got "${queue.mode}").`);
    }
    if (!Array.isArray(queue.slots) || queue.slots.length === 0) {
        errors.push('Queue must have at least one slot.');
    } else {
        queue.slots.forEach((slot, i) => {
            if (!slot.profileName) {
                errors.push(`Slot ${i + 1} is missing a profile name.`);
            } else if (availableProfileNames && !availableProfileNames.includes(slot.profileName)) {
                errors.push(`Slot ${i + 1}: profile "${slot.profileName}" does not exist.`);
            }
            // Every count field that is present must be a finite number,
            // whichever countMode/queue mode is active. The editor renders
            // the inactive fields too, and imported JSON can carry anything —
            // a non-numeric value here would otherwise flow into the editor's
            // DOM untouched.
            for (const field of ['fixedCount', 'minCount', 'maxCount', 'weight']) {
                if (slot[field] != null && !Number.isFinite(slot[field])) {
                    errors.push(`Slot ${i + 1}: ${field} must be a number.`);
                }
            }
            if (queue.mode === 'sequential') {
                if (slot.countMode === 'fixed') {
                    if (!Number.isFinite(slot.fixedCount) || slot.fixedCount < 1) {
                        errors.push(`Slot ${i + 1}: fixed count must be >= 1.`);
                    }
                } else if (slot.countMode === 'range') {
                    if (!Number.isFinite(slot.minCount) || !Number.isFinite(slot.maxCount)) {
                        errors.push(`Slot ${i + 1}: range needs min and max numbers.`);
                    } else if (slot.minCount < 1 || slot.maxCount < slot.minCount) {
                        errors.push(`Slot ${i + 1}: invalid range (min >= 1, max >= min).`);
                    }
                } else {
                    errors.push(`Slot ${i + 1}: countMode must be "fixed" or "range".`);
                }
            } else if (queue.mode === 'weighted-random') {
                if (slot.weight !== undefined && (!Number.isFinite(slot.weight) || slot.weight < 0)) {
                    errors.push(`Slot ${i + 1}: weight must be a non-negative number.`);
                }
            }
            // Optional tuning block (v1.2 inline sampler tuning). Structural
            // validation only — the per-API param semantics live in
            // src/sampling.js to keep this module ST-free.
            if (slot.tuning != null) {
                if (typeof slot.tuning !== 'object') {
                    errors.push(`Slot ${i + 1}: tuning must be an object or absent.`);
                } else {
                    if (typeof slot.tuning.enabled !== 'boolean') {
                        errors.push(`Slot ${i + 1}: tuning.enabled must be a boolean.`);
                    }
                    if (slot.tuning.params != null
                        && typeof slot.tuning.params === 'object') {
                        for (const [k, v] of Object.entries(slot.tuning.params)) {
                            if (v != null && !Number.isFinite(v)) {
                                errors.push(`Slot ${i + 1}: tuning.params.${k} must be a finite number.`);
                            }
                        }
                    } else if (slot.tuning.params != null) {
                        errors.push(`Slot ${i + 1}: tuning.params must be an object.`);
                    }
                }
            }
        });
    }
    if (queue.mode === 'weighted-random' && queue.weightedRunCount) {
        const c = queue.weightedRunCount;
        if (c.mode === 'fixed') {
            if (!Number.isFinite(c.fixed) || c.fixed < 1) {
                errors.push('weightedRunCount.fixed must be >= 1.');
            }
        } else if (c.mode === 'range') {
            if (!Number.isFinite(c.min) || !Number.isFinite(c.max) || c.min < 1 || c.max < c.min) {
                errors.push('weightedRunCount range: min >= 1, max >= min.');
            }
        }
    }
    return errors;
}

/**
 * Decide what a chat-load should do about a character's bound queue.
 *
 * Pure on purpose: the surrounding wiring (reading ST's character list,
 * firing the switch) is untestable, but these precedence rules are exactly
 * the part that is easy to get subtly wrong, so they live here where a test
 * can pin them down.
 *
 * The rules, in order:
 *  - No character context (group chat, or no character loaded) -> nothing.
 *  - Already settled for this chat -> nothing. This is what stops a rotation
 *    the user deliberately stopped from restarting on every chat re-open.
 *  - Chat already has its own rotation running -> never clobber it; just mark
 *    the question settled so we stop reconsidering it.
 *  - Binding points at a queue that no longer exists -> drop the stale binding.
 *  - Otherwise -> start it.
 *
 * @param {object} input
 * @param {boolean} input.hasCharacter    a non-group character is loaded
 * @param {string|null} input.boundQueueId queue bound to that character
 * @param {boolean} input.queueExists     the bound queue still resolves
 * @param {{activeQueueId: string|null, autoBindHandled: boolean}} input.chatState
 * @returns {{action: 'start'|'mark-handled'|'clear-binding'|'none', reason: string}}
 */
export function decideAutoActivation({ hasCharacter, boundQueueId, queueExists, chatState }) {
    if (!hasCharacter) {
        return { action: 'none', reason: 'no character context (group chat or nothing loaded)' };
    }
    if (!boundQueueId) {
        return { action: 'none', reason: 'character has no bound queue' };
    }
    if (chatState?.autoBindHandled) {
        return { action: 'none', reason: 'binding already settled for this chat' };
    }
    if (chatState?.activeQueueId) {
        return { action: 'mark-handled', reason: 'chat already has a rotation; leaving it alone' };
    }
    if (!queueExists) {
        return { action: 'clear-binding', reason: 'bound queue no longer exists' };
    }
    return { action: 'start', reason: 'starting bound queue for this character' };
}
