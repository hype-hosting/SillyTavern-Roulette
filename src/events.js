/* SillyTavern-Roulette — AGPL-3.0
 *
 * Event wiring + scheduler. Listens to:
 *   - MESSAGE_RECEIVED        decrement counter (on countable types only)
 *   - GENERATION_STARTED      switch profile if a switch is pending
 *   - CHAT_CHANGED            reload state, refresh UI, auto-start bound queue
 *   - APP_READY               catch boot-time auto-start if we registered late
 *   - CONNECTION_PROFILE_LOADED   detect manual override (ignore our own switches)
 *   - CHARACTER_DELETED       purge that character's queue binding
 *   - CHARACTER_RENAMED       follow the binding to the new avatar key
 */

import { eventSource, event_types } from '../../../../../script.js';
import { getChatState, updateChatState, findQueue, setLastQueueId } from './state.js';
import {
    isCountableGeneration,
    pickInitialSlot,
    advanceSlot,
    indexOfSlot,
    appendHistory,
    decideAutoActivation,
} from './rotation.js';
import { switchProfile, isInternalSwitch, profileExists, currentProfileName } from './profileSwitcher.js';
import { applyTuningOnSwitch } from './sampling.js';
import {
    getCurrentCharacter,
    getBoundQueueId,
    clearBinding,
    purgeBindingsForCharacter,
    remapBinding,
} from './characterBinding.js';

/**
 * Per-rotation transient state, kept in-memory only:
 * tracks consecutive switch failures so we can halt rotation after 3.
 */
let consecutiveFailures = 0;
let failedSlotIndices = new Set(); // indices of slots that failed in the current re-roll cycle
const MAX_CONSECUTIVE_FAILURES = 3;

let switchInFlight = null; // promise guard — only one switch at a time

/**
 * Generation type of the most recent (non-dry) GENERATION_STARTED.
 *
 * Needed because ST's MESSAGE_RECEIVED type can lie: a non-streaming
 * regenerate deletes the AI message being redone *before* generating, so by
 * the time saveReply emits MESSAGE_RECEIVED the last message is the user's
 * and the type is coerced to 'normal'. The GENERATION_STARTED that produced
 * that message still carried 'regenerate', so we remember it and consult it
 * when counting. (Assumes generations don't interleave — ST serializes the
 * main generation pipeline.)
 *
 * Known hole: GROUP-chat regenerates are indistinguishable at the event
 * level — regenerateGroup() deletes the old reply and re-generates typed
 * 'normal' end to end, so they still count. Solo chats are fully covered.
 */
let lastGenerationType;

/** Subscribers notified on any rotation-state change (used by the UI). */
const stateChangeListeners = new Set();
export function onRotationStateChanged(listener) {
    stateChangeListeners.add(listener);
    return () => stateChangeListeners.delete(listener);
}

/**
 * Ping every UI surface to re-read state and re-render.
 *
 * Exported because queue definitions live in extension_settings, not in the
 * rotation state — so the modal's create / delete / import paths have no
 * other way to tell the pinned bar that its queue picker is now stale.
 */
export function notifyStateChanged() {
    for (const fn of stateChangeListeners) {
        try { fn(); } catch (err) { console.error('[Roulette] state listener threw', err); }
    }
}

/**
 * Activate a queue on the current chat. Picks the initial slot, fires the
 * profile switch, and writes state.
 *
 * @param {string} queueId
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function startRotation(queueId) {
    const queue = findQueue(queueId);
    if (!queue) {
        return { ok: false, error: `Queue ${queueId} not found.` };
    }
    if (!Array.isArray(queue.slots) || queue.slots.length === 0) {
        return { ok: false, error: `Queue "${queue.name}" has no slots.` };
    }

    consecutiveFailures = 0;
    failedSlotIndices.clear();
    // The bar offers the last-run queue when idle, so record it before the
    // switch — even a start that fails mid-recovery was still a deliberate
    // choice of this queue.
    setLastQueueId(queue.id);

    const pick = pickInitialSlot(queue);
    if (!pick) {
        return { ok: false, error: 'Could not pick an initial slot (all weights zero?).' };
    }
    const slot = queue.slots[pick.slotIndex];

    updateChatState(state => {
        state.activeQueueId = queue.id;
        state.currentSlotId = pick.slotId;
        state.responsesRemaining = pick.responses;
        state.responsesAllotted = pick.responses;
        state.manuallyOverridden = false;
        state.lastSwitchMessageId = null;
        // Whoever started this chat's rotation — the user or the character
        // binding — has answered the auto-start question for this chat.
        state.autoBindHandled = true;
    });

    const switched = await switchProfile(slot.profileName);
    if (!switched) {
        // Mark this slot as failed and try to advance immediately.
        failedSlotIndices.add(pick.slotIndex);
        consecutiveFailures++;
        const recovered = await tryAdvanceFromFailure(queue, pick.slotIndex, { notify: false });
        if (!recovered) {
            stopRotation();
            return { ok: false, error: `Failed to switch to "${slot.profileName}" and could not recover.` };
        }
    } else {
        // Profile applied OK — overlay the slot's sampler tuning if any.
        await applyTuningOnSwitch(slot, queue);
    }
    notifyStateChanged();
    return { ok: true };
}

/**
 * Stop rotation on the current chat.
 */
export function stopRotation() {
    updateChatState(state => {
        state.activeQueueId = null;
        state.currentSlotId = null;
        state.responsesRemaining = 0;
        state.manuallyOverridden = false;
        // A stop is a deliberate choice about this chat. Without this the
        // character binding would restart the rotation the next time the
        // chat is opened, and the user could never turn it off.
        state.autoBindHandled = true;
    });
    consecutiveFailures = 0;
    failedSlotIndices.clear();
    notifyStateChanged();
}

/**
 * Resume rotation after a manual override.
 *
 * Spec (CLAUDE.md §5): if the profile the user is sitting on matches the
 * current slot, just continue. Otherwise the responses generated while
 * paused belong to a foreign profile — zero the counter so the next
 * generation starts a fresh rotation cycle (advance/re-pick + switch)
 * instead of counting them against the slot.
 */
export function resumeRotation() {
    const state = getChatState();
    const queue = state.activeQueueId ? findQueue(state.activeQueueId) : null;
    const slot = queue?.slots.find(s => s.id === state.currentSlotId);
    const loadedProfile = currentProfileName();
    // An unresolvable current profile ('<None>' selected, or the manually
    // picked profile was deleted) is divergence too — there is no profile the
    // slot could legitimately be "on", so the next generation must re-switch.
    const diverged = !!(slot && slot.profileName !== loadedProfile);
    updateChatState(s => {
        s.manuallyOverridden = false;
        if (diverged) {
            s.responsesRemaining = 0;
        }
    });
    consecutiveFailures = 0;
    failedSlotIndices.clear();
    notifyStateChanged();
}

/**
 * Force-advance to the next slot immediately (used by /roulette-skip and the
 * status-indicator "Skip" affordance).
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function skipCurrentSlot() {
    const state = getChatState();
    if (!state.activeQueueId) {
        return { ok: false, error: 'Rotation is not active.' };
    }
    const queue = findQueue(state.activeQueueId);
    if (!queue) {
        stopRotation();
        return { ok: false, error: 'Active queue no longer exists; rotation stopped.' };
    }
    const currentIndex = indexOfSlot(queue, state.currentSlotId);
    failedSlotIndices.clear();
    const next = advanceSlot(queue, currentIndex);
    if (!next) {
        stopRotation();
        return { ok: false, error: 'No eligible slot to advance to.' };
    }
    updateChatState(s => {
        s.currentSlotId = next.slotId;
        s.responsesRemaining = next.responses;
        s.responsesAllotted = next.responses;
        s.manuallyOverridden = false;
    });
    const slot = queue.slots[next.slotIndex];
    const ok = await switchProfile(slot.profileName);
    if (!ok) {
        // try to recover
        failedSlotIndices.add(next.slotIndex);
        consecutiveFailures++;
        const recovered = await tryAdvanceFromFailure(queue, next.slotIndex, { notify: false });
        if (!recovered) {
            stopRotation();
            return { ok: false, error: `Skip failed and recovery exhausted.` };
        }
    } else {
        consecutiveFailures = 0;
        failedSlotIndices.clear();
        await applyTuningOnSwitch(slot, queue);
    }
    notifyStateChanged();
    return { ok: true };
}

/**
 * Attempt to advance past a failed slot. Recurses (bounded by
 * MAX_CONSECUTIVE_FAILURES) until a switch succeeds or we give up.
 *
 * `notify` toasts the give-up reason. Pass false from paths whose caller
 * already surfaces the returned error (startRotation/skipCurrentSlot) —
 * otherwise one failed click stacks two error toasts. The mid-rotation
 * GENERATION_STARTED path has no caller to report to, so it keeps the toast.
 *
 * @returns {Promise<boolean>} true if recovery succeeded
 */
async function tryAdvanceFromFailure(queue, lastFailedIndex, { notify = true } = {}) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        const msg = `Roulette: ${consecutiveFailures} consecutive profile-switch failures. Halting rotation.`;
        console.error(msg);
        if (notify && typeof toastr !== 'undefined') toastr.error(msg);
        return false;
    }
    const next = advanceSlot(queue, lastFailedIndex, [...failedSlotIndices]);
    if (!next) {
        const msg = 'Roulette: no eligible slot remains. Halting rotation.';
        console.error(msg);
        if (notify && typeof toastr !== 'undefined') toastr.error(msg);
        return false;
    }
    const slot = queue.slots[next.slotIndex];
    if (!profileExists(slot.profileName)) {
        failedSlotIndices.add(next.slotIndex);
        consecutiveFailures++;
        return tryAdvanceFromFailure(queue, next.slotIndex, { notify });
    }
    const ok = await switchProfile(slot.profileName);
    if (!ok) {
        failedSlotIndices.add(next.slotIndex);
        consecutiveFailures++;
        return tryAdvanceFromFailure(queue, next.slotIndex, { notify });
    }
    await applyTuningOnSwitch(slot, queue);
    updateChatState(s => {
        s.currentSlotId = next.slotId;
        s.responsesRemaining = next.responses;
        s.responsesAllotted = next.responses;
    });
    consecutiveFailures = 0;
    failedSlotIndices.clear();
    return true;
}

/**
 * MESSAGE_RECEIVED handler: decrement the response counter.
 *
 * Filtering rule: only "normal" generations consume a slot. Swipes,
 * regens, continues, impersonations, quiet, first_message — all skipped.
 */
async function onMessageReceived(messageId, type) {
    if (!isCountableGeneration(type)) return;
    // The emitted type can be coerced to 'normal' (see lastGenerationType);
    // trust the type the generation actually started with. Messages that
    // never fire GENERATION_STARTED ('command', 'extension', 'first_message')
    // are already rejected by their own type above.
    if (!isCountableGeneration(lastGenerationType)) return;
    const state = getChatState();
    if (!state.activeQueueId || state.manuallyOverridden) return;
    const queue = findQueue(state.activeQueueId);
    if (!queue) {
        stopRotation();
        return;
    }

    updateChatState(s => {
        // Append history first so the message that just arrived is logged
        // against the slot that produced it.
        const slot = queue.slots.find(x => x.id === s.currentSlotId);
        const profileName = slot?.profileName ?? '?';
        const next = appendHistory(s, {
            messageId,
            profileName,
            timestamp: Date.now(),
        });
        next.responsesRemaining = Math.max(0, (s.responsesRemaining | 0) - 1);
        return next;
    });
    notifyStateChanged();
}

/**
 * GENERATION_STARTED handler: if the current slot's counter is exhausted,
 * pick the next slot and switch profiles before the model generates.
 *
 * Skips dryRun and non-countable generation types.
 */
async function onGenerationStarted(type, _options, dryRun) {
    if (dryRun) return;
    lastGenerationType = type;
    if (!isCountableGeneration(type)) return;
    const state = getChatState();
    if (!state.activeQueueId || state.manuallyOverridden) return;
    const queue = findQueue(state.activeQueueId);
    if (!queue) {
        stopRotation();
        return;
    }
    if (state.responsesRemaining > 0) return;

    // counter exhausted — switch.
    if (switchInFlight) {
        // Defer to the in-flight switch.
        await switchInFlight;
        return;
    }

    const currentIndex = indexOfSlot(queue, state.currentSlotId);
    failedSlotIndices.clear();
    const next = advanceSlot(queue, currentIndex);
    if (!next) {
        stopRotation();
        return;
    }
    const slot = queue.slots[next.slotIndex];

    switchInFlight = (async () => {
        updateChatState(s => {
            s.currentSlotId = next.slotId;
            s.responsesRemaining = next.responses;
            s.responsesAllotted = next.responses;
            s.lastSwitchMessageId = state.history.at(-1)?.messageId ?? null;
        });
        const ok = await switchProfile(slot.profileName);
        if (!ok) {
            failedSlotIndices.add(next.slotIndex);
            consecutiveFailures++;
            const recovered = await tryAdvanceFromFailure(queue, next.slotIndex);
            if (!recovered) {
                // Recovery exhausted (3 consecutive failures, or no eligible
                // slot left): actually halt, per spec — otherwise the bar
                // keeps showing a "running" rotation whose switches all fail.
                stopRotation();
            }
        } else {
            consecutiveFailures = 0;
            failedSlotIndices.clear();
            await applyTuningOnSwitch(slot, queue);
        }
        notifyStateChanged();
    })();
    try {
        await switchInFlight;
    } finally {
        switchInFlight = null;
    }
}

/** Guards against two chat-load events racing into a double start. */
let autoActivateInFlight = false;

/**
 * Start the queue bound to the current character, if the situation calls for
 * it. Safe to call as often as you like — the precedence rules live in the
 * pure decideAutoActivation() and the result is latched per-chat via
 * `autoBindHandled`, so repeat calls are no-ops.
 *
 * @returns {Promise<void>}
 */
export async function maybeAutoActivateForCharacter() {
    if (autoActivateInFlight) return;

    const character = getCurrentCharacter();
    const boundQueueId = character ? getBoundQueueId(character.key) : null;
    const queue = boundQueueId ? findQueue(boundQueueId) : null;

    const decision = decideAutoActivation({
        hasCharacter: !!character,
        boundQueueId,
        queueExists: !!queue,
        chatState: getChatState(),
    });

    if (decision.action === 'none') return;

    if (decision.action === 'mark-handled') {
        updateChatState(s => { s.autoBindHandled = true; });
        return;
    }

    if (decision.action === 'clear-binding') {
        console.warn(`[Roulette] "${character.name}" was bound to a queue that no longer exists — dropping the binding.`);
        clearBinding(character.key);
        notifyStateChanged();
        return;
    }

    // decision.action === 'start'
    autoActivateInFlight = true;
    try {
        const result = await startRotation(queue.id);
        if (result.ok) {
            console.log(`[Roulette] auto-started "${queue.name}" for ${character.name}`);
            if (typeof toastr !== 'undefined') {
                toastr.info(`Roulette: started "${queue.name}" for ${character.name}.`);
            }
        } else {
            console.warn(`[Roulette] auto-start for ${character.name} failed: ${result.error}`);
            if (typeof toastr !== 'undefined') {
                toastr.warning(`Roulette: could not auto-start "${queue.name}" — ${result.error}`);
            }
        }
    } finally {
        autoActivateInFlight = false;
    }
}

/**
 * Re-open the auto-start question for the current chat, then answer it.
 *
 * Called when the user changes a binding from the UI. Without this, binding
 * a character while already sitting in their chat would appear to do nothing
 * until the chat was reopened — the `autoBindHandled` latch would still be
 * set from this chat's earlier load.
 *
 * Clearing the latch cannot disturb a rotation that is already running:
 * decideAutoActivation() returns 'mark-handled' for that case and leaves the
 * active queue untouched.
 *
 * @returns {Promise<void>}
 */
export async function reevaluateAutoActivation() {
    updateChatState(s => { s.autoBindHandled = false; });
    await maybeAutoActivateForCharacter();
}

/**
 * CHAT_CHANGED handler: per-chat state lives in chat_metadata, which ST
 * rebinds *before* emitting this event (script.js sets chat_metadata during
 * chat load and emits afterwards), so it is safe to read the new chat's
 * rotation state here — and therefore safe to decide whether the incoming
 * character's bound queue should auto-start.
 */
async function onChatChanged(_chatId) {
    consecutiveFailures = 0;
    failedSlotIndices.clear();
    lastGenerationType = undefined;
    notifyStateChanged();
    await maybeAutoActivateForCharacter();
}

/**
 * CHARACTER_DELETED handler. ST emits `{ id, character }`; the character's
 * avatar filename is our binding key.
 */
function onCharacterDeleted(payload) {
    const avatar = payload?.character?.avatar;
    if (!avatar) return;
    if (purgeBindingsForCharacter(avatar)) {
        console.log(`[Roulette] dropped queue binding for deleted character ${avatar}`);
        notifyStateChanged();
    }
}

/**
 * CHARACTER_RENAMED handler. ST emits `(oldAvatar, newAvatar)` — the avatar
 * filename tracks the character name, so a rename moves our storage key.
 */
function onCharacterRenamed(oldAvatar, newAvatar) {
    if (remapBinding(oldAvatar, newAvatar)) {
        console.log(`[Roulette] moved queue binding ${oldAvatar} -> ${newAvatar}`);
        notifyStateChanged();
    }
}

/**
 * CONNECTION_PROFILE_LOADED handler: detects manual user-driven switches.
 * Suppressed during our own programmatic switches via the isInternalSwitch
 * flag (set in profileSwitcher.switchProfile).
 */
async function onConnectionProfileLoaded(profileName) {
    if (isInternalSwitch()) return;
    const state = getChatState();
    if (!state.activeQueueId || state.manuallyOverridden) return;
    const queue = findQueue(state.activeQueueId);
    if (!queue) return;
    const currentSlot = queue.slots.find(s => s.id === state.currentSlotId);
    // If the user happened to switch to the same profile our slot points to,
    // it's not really an override — leave rotation alone.
    if (currentSlot && currentSlot.profileName === profileName) return;
    updateChatState(s => {
        s.manuallyOverridden = true;
    });
    notifyStateChanged();
}

let registered = false;

/**
 * Register all event listeners. Idempotent.
 */
export function registerEventListeners() {
    if (registered) return;
    registered = true;
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onConnectionProfileLoaded);
    eventSource.on(event_types.CHARACTER_DELETED, onCharacterDeleted);
    eventSource.on(event_types.CHARACTER_RENAMED, onCharacterRenamed);
    // Safety net for the boot-time case. ST inits extensions before loading
    // the first chat, so CHAT_CHANGED normally covers startup on its own —
    // but if this extension is ever loaded late, eventSource replays
    // APP_READY to listeners that register after it fired (its
    // autoFireAfterEmit set covers APP_READY), so we still catch up.
    // Idempotent: the per-chat `autoBindHandled` latch absorbs the overlap.
    eventSource.on(event_types.APP_READY, () => {
        maybeAutoActivateForCharacter().catch(err =>
            console.error('[Roulette] APP_READY auto-activate failed:', err));
    });
}
