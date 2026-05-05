/* SillyTavern-Roulette — AGPL-3.0
 *
 * Event wiring + scheduler. Listens to:
 *   - MESSAGE_RECEIVED        decrement counter (on countable types only)
 *   - GENERATION_STARTED      switch profile if a switch is pending
 *   - CHAT_CHANGED            reload state + refresh status indicator
 *   - CONNECTION_PROFILE_LOADED   detect manual override (ignore our own switches)
 */

import { eventSource, event_types } from '../../../../../script.js';
import { getChatState, updateChatState, findQueue } from './state.js';
import {
    isCountableGeneration,
    pickInitialSlot,
    advanceSlot,
    indexOfSlot,
    appendHistory,
    rollSlotResponses,
} from './rotation.js';
import { switchProfile, isInternalSwitch, profileExists } from './profileSwitcher.js';

/**
 * Per-rotation transient state, kept in-memory only:
 * tracks consecutive switch failures so we can halt rotation after 3.
 */
let consecutiveFailures = 0;
let failedSlotIndices = new Set(); // indices of slots that failed in the current re-roll cycle
const MAX_CONSECUTIVE_FAILURES = 3;

let switchInFlight = null; // promise guard — only one switch at a time

/** Subscribers notified on any rotation-state change (used by the UI). */
const stateChangeListeners = new Set();
export function onRotationStateChanged(listener) {
    stateChangeListeners.add(listener);
    return () => stateChangeListeners.delete(listener);
}
function notifyStateChanged() {
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

    const pick = pickInitialSlot(queue);
    if (!pick) {
        return { ok: false, error: 'Could not pick an initial slot (all weights zero?).' };
    }
    const slot = queue.slots[pick.slotIndex];

    updateChatState(state => {
        state.activeQueueId = queue.id;
        state.currentSlotId = pick.slotId;
        state.responsesRemaining = pick.responses;
        state.manuallyOverridden = false;
        state.lastSwitchMessageId = null;
    });

    const switched = await switchProfile(slot.profileName);
    if (!switched) {
        // Mark this slot as failed and try to advance immediately.
        failedSlotIndices.add(pick.slotIndex);
        consecutiveFailures++;
        const recovered = await tryAdvanceFromFailure(queue, pick.slotIndex);
        if (!recovered) {
            stopRotation();
            return { ok: false, error: `Failed to switch to "${slot.profileName}" and could not recover.` };
        }
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
    });
    consecutiveFailures = 0;
    failedSlotIndices.clear();
    notifyStateChanged();
}

/**
 * Resume rotation after a manual override.
 */
export function resumeRotation() {
    updateChatState(state => {
        state.manuallyOverridden = false;
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
        s.manuallyOverridden = false;
    });
    const slot = queue.slots[next.slotIndex];
    const ok = await switchProfile(slot.profileName);
    if (!ok) {
        // try to recover
        failedSlotIndices.add(next.slotIndex);
        consecutiveFailures++;
        const recovered = await tryAdvanceFromFailure(queue, next.slotIndex);
        if (!recovered) {
            stopRotation();
            return { ok: false, error: `Skip failed and recovery exhausted.` };
        }
    }
    notifyStateChanged();
    return { ok: true };
}

/**
 * Attempt to advance past a failed slot. Recurses (bounded by
 * MAX_CONSECUTIVE_FAILURES) until a switch succeeds or we give up.
 *
 * @returns {Promise<boolean>} true if recovery succeeded
 */
async function tryAdvanceFromFailure(queue, lastFailedIndex) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        const msg = `Roulette: ${consecutiveFailures} consecutive profile-switch failures. Halting rotation.`;
        console.error(msg);
        if (typeof toastr !== 'undefined') toastr.error(msg);
        return false;
    }
    const next = advanceSlot(queue, lastFailedIndex, [...failedSlotIndices]);
    if (!next) {
        const msg = 'Roulette: no eligible slot remains. Halting rotation.';
        console.error(msg);
        if (typeof toastr !== 'undefined') toastr.error(msg);
        return false;
    }
    const slot = queue.slots[next.slotIndex];
    if (!profileExists(slot.profileName)) {
        failedSlotIndices.add(next.slotIndex);
        consecutiveFailures++;
        return tryAdvanceFromFailure(queue, next.slotIndex);
    }
    const ok = await switchProfile(slot.profileName);
    if (!ok) {
        failedSlotIndices.add(next.slotIndex);
        consecutiveFailures++;
        return tryAdvanceFromFailure(queue, next.slotIndex);
    }
    updateChatState(s => {
        s.currentSlotId = next.slotId;
        s.responsesRemaining = next.responses;
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
            s.lastSwitchMessageId = state.history.at(-1)?.messageId ?? null;
        });
        const ok = await switchProfile(slot.profileName);
        if (!ok) {
            failedSlotIndices.add(next.slotIndex);
            consecutiveFailures++;
            await tryAdvanceFromFailure(queue, next.slotIndex);
        }
        notifyStateChanged();
    })();
    try {
        await switchInFlight;
    } finally {
        switchInFlight = null;
    }
}

/**
 * CHAT_CHANGED handler: per-chat state lives in chat_metadata, which ST
 * rebinds when the chat changes — just notify the UI to re-render.
 */
async function onChatChanged(_chatId) {
    consecutiveFailures = 0;
    failedSlotIndices.clear();
    notifyStateChanged();
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
}

/**
 * Re-roll the responses-remaining counter from the current slot's config.
 * Used when activating a queue if state is corrupt or after manual overrides.
 */
export function rerollCurrentSlotCounter() {
    const state = getChatState();
    if (!state.activeQueueId) return;
    const queue = findQueue(state.activeQueueId);
    if (!queue) return;
    const slot = queue.slots.find(s => s.id === state.currentSlotId);
    if (!slot) return;
    const responses = rollSlotResponses(slot, queue);
    updateChatState(s => { s.responsesRemaining = responses; });
    notifyStateChanged();
}
