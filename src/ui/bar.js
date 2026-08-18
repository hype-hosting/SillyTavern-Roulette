/* SillyTavern-Roulette — AGPL-3.0
 *
 * The pinned status bar — v2.0's replacement for both the floating widget
 * and the chat-input pill.
 *
 * A single full-width row that lives inside SillyTavern's chat column, at
 * one of three user-chosen positions (above the message input, below it, or
 * above the message list). It is the extension's primary surface: the dot
 * strip, the current profile, Skip / Stop, and the gear that opens the modal.
 *
 * Idle and active render as the same object — same dots in the same places,
 * unlit versus lit — so starting a rotation reads as the bar coming alive
 * rather than as one control being swapped for another.
 *
 * Visibility is a pure UI preference (extension_settings.roulette.ui.bar.
 * enabled), toggled from the Extensions drawer. Hiding the bar does not stop
 * a running rotation or block character auto-start bindings; it only removes
 * the chrome.
 */

import {
    getSettings,
    getChatState,
    findQueue,
    preferredQueue,
    setLastQueueId,
    persistSettings,
    BAR_POSITIONS,
    DEFAULT_BAR_POSITION,
} from '../state.js';
import {
    startRotation,
    stopRotation,
    resumeRotation,
    skipCurrentSlot,
    onRotationStateChanged,
    notifyStateChanged,
} from '../events.js';
import { mountDotStrip } from './dotStrip.js';
import { colorForProfile } from './profileColors.js';
import { openRouletteModal } from './modal.js';

let barEl = null;
let unsubscribeStateChange = null;

/* ------------------------------------------------------------------ *
 * Mounting
 * ------------------------------------------------------------------ */

/**
 * Mount the bar if the user has it enabled. Idempotent.
 */
export function mountBar() {
    if (!getSettings().ui.bar.enabled) return;
    if (barEl?.isConnected) return;
    if (!barEl) build();
    // Subscribe before attaching: if ST's chat chrome isn't in the DOM yet
    // (unusually late extension load), render() re-runs attach() on the next
    // rotation-state change — including the CHAT_CHANGED that follows boot —
    // so the bar self-heals instead of needing a manual re-toggle.
    if (!unsubscribeStateChange) {
        unsubscribeStateChange = onRotationStateChanged(render);
    }
    attach();
    render();
}

/**
 * Remove the bar from the DOM and drop its subscription.
 */
export function unmountBar() {
    if (unsubscribeStateChange) {
        unsubscribeStateChange();
        unsubscribeStateChange = null;
    }
    barEl?.remove();
    barEl = null;
}

/**
 * Show or hide the bar; persists. Called from the Extensions drawer toggle
 * and the modal's Settings tab.
 */
export function setBarEnabled(enabled) {
    const settings = getSettings();
    settings.ui.bar.enabled = !!enabled;
    persistSettings();
    if (enabled) mountBar();
    else unmountBar();
    // The drawer's Enable/Disable label and the modal's Settings toggle both
    // mirror this flag; ping them so whichever one wasn't clicked catches up.
    notifyStateChanged();
}

/** @returns {boolean} */
export function isBarEnabled() {
    return !!getSettings().ui.bar.enabled;
}

/**
 * Move the bar to a different anchor; persists. Re-parents the existing node
 * rather than rebuilding, so nothing flashes.
 */
export function setBarPosition(position) {
    const settings = getSettings();
    settings.ui.bar.position = BAR_POSITIONS.includes(position) ? position : DEFAULT_BAR_POSITION;
    persistSettings();
    if (barEl) attach();
}

/**
 * Insert the bar at the anchor its position setting names.
 *
 * SillyTavern's chat column (#sheld) stacks the message list (#chat) above
 * the input form (#send_form), so the three positions are three insertion
 * points among those siblings. Returns false when ST's chrome isn't present
 * yet — the caller just skips this mount and tries again later.
 *
 * @returns {boolean} true if the bar is now in the document
 */
function attach() {
    const chat = document.getElementById('chat');
    const form = document.getElementById('send_form');
    const position = getSettings().ui.bar.position;

    let anchor = null;
    let mode = 'before';
    if (position === 'above-chat' && chat?.parentElement) {
        anchor = chat;
    } else if (position === 'below-input' && form?.parentElement) {
        anchor = form;
        mode = 'after';
    } else if (form?.parentElement) {
        anchor = form; // 'above-input', and the fallback for everything else
    } else if (chat?.parentElement) {
        anchor = chat;
        mode = 'after';
    }

    if (!anchor) {
        console.warn('[Roulette] chat chrome not found; bar not mounted');
        return false;
    }
    if (mode === 'after') anchor.after(barEl);
    else anchor.before(barEl);

    barEl.dataset.barPosition = position;
    return true;
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

function build() {
    barEl = document.createElement('div');
    barEl.className = 'roulette-extension roulette-bar';
    barEl.setAttribute('role', 'region');
    barEl.setAttribute('aria-label', 'Roulette rotation');
    // Left-to-right: gear, transport (start / skip / stop / resume), queue
    // label, dots. Controls cluster at the left edge; the dots trail the
    // label and free space falls to the right.
    barEl.innerHTML = `
        <div class="roulette-bar-actions">
            <button type="button" class="roulette-bar-btn roulette-bar-btn-gear" data-act="open" title="Open Roulette" aria-label="Open Roulette">
                <i class="fa-solid fa-gear"></i>
            </button>
            <button type="button" class="roulette-bar-btn roulette-bar-btn-go" data-act="start" title="Start rotation" aria-label="Start rotation">
                <i class="fa-solid fa-play"></i>
            </button>
            <button type="button" class="roulette-bar-btn roulette-bar-btn-stop" data-act="stop" title="Stop rotation" aria-label="Stop rotation">
                <i class="fa-solid fa-stop"></i>
            </button>
            <button type="button" class="roulette-bar-btn roulette-bar-btn-go" data-act="resume" title="Resume rotation" aria-label="Resume rotation">
                <i class="fa-solid fa-play"></i>
            </button>
            <button type="button" class="roulette-bar-btn" data-act="skip" title="Skip to the next slot" aria-label="Skip to the next slot">
                <i class="fa-solid fa-forward"></i>
            </button>
        </div>
        <div class="roulette-bar-label">
            <select class="roulette-bar-queue" data-field="queue" aria-label="Queue to start"></select>
            <span class="roulette-bar-profile" data-field="profile"></span>
        </div>
        <div class="roulette-bar-dots" data-field="dots"></div>
    `;
    wire();
}

function wire() {
    const queueSel = barEl.querySelector('[data-field="queue"]');
    queueSel.addEventListener('change', () => {
        // Remember the pick immediately, so it survives a reload even if the
        // user never presses Start.
        setLastQueueId(queueSel.value || null);
        render();
    });

    barEl.querySelector('[data-act="start"]').addEventListener('click', async () => {
        const queueId = queueSel.value;
        if (!queueId) {
            openRouletteModal('queues');
            return;
        }
        const result = await startRotation(queueId);
        if (!result.ok && typeof toastr !== 'undefined') {
            toastr.error(`Roulette: ${result.error}`);
        }
    });
    barEl.querySelector('[data-act="skip"]').addEventListener('click', async () => {
        const result = await skipCurrentSlot();
        if (!result.ok && typeof toastr !== 'undefined') {
            toastr.warning(`Roulette: ${result.error}`);
        }
    });
    barEl.querySelector('[data-act="stop"]').addEventListener('click', () => stopRotation());
    barEl.querySelector('[data-act="resume"]').addEventListener('click', () => resumeRotation());
    barEl.querySelector('[data-act="open"]').addEventListener('click', () => openRouletteModal());
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function render() {
    if (!barEl) return;
    // ST rebuilds parts of its chrome on some transitions; if that stranded
    // us, slot back in rather than silently going missing.
    if (!barEl.isConnected && !attach()) return;

    const state = getChatState();
    const activeQueue = state.activeQueueId ? findQueue(state.activeQueueId) : null;
    const running = !!activeQueue;
    const paused = running && !!state.manuallyOverridden;

    // Idle borrows the last-run queue so the strip shows the shape of what
    // pressing Start would actually launch.
    const shownQueue = activeQueue ?? preferredQueue();

    barEl.classList.toggle('roulette-bar-running', running);
    barEl.classList.toggle('roulette-bar-paused', paused);
    barEl.classList.toggle('roulette-bar-idle', !running);

    mountDotStrip(barEl.querySelector('[data-field="dots"]'), {
        slots: shownQueue?.slots ?? [],
        activeSlotId: running ? state.currentSlotId : null,
        mode: shownQueue?.mode ?? 'sequential',
        variant: 'bar',
        responsesRemaining: state.responsesRemaining,
        responsesAllotted: state.responsesAllotted,
        paused,
        idle: !running,
    });

    renderLabel(activeQueue, shownQueue, state, paused);
    renderActions(running, paused, shownQueue);
}

function renderLabel(activeQueue, shownQueue, state, paused) {
    const queueSel = barEl.querySelector('[data-field="queue"]');
    const profileEl = barEl.querySelector('[data-field="profile"]');
    const running = !!activeQueue;

    queueSel.classList.toggle('hidden', running);
    profileEl.classList.toggle('hidden', !running);

    if (running) {
        const slot = activeQueue.slots.find(s => s.id === state.currentSlotId);
        const profile = slot?.profileName || 'unassigned';
        profileEl.textContent = paused ? 'paused' : profile;
        profileEl.title = paused
            ? `Paused by a manual profile switch — ${activeQueue.name} is still loaded`
            : `${profile} · ${activeQueue.name}`;
        profileEl.style.setProperty('--dot-color', colorForProfile(profile) ?? 'var(--roulette-text-muted)');
        return;
    }

    // Idle: the select doubles as the queue label, so it is rebuilt on every
    // render — queues can be created or deleted in the modal while the bar
    // is on screen.
    const queues = getSettings().queues;
    const wanted = shownQueue?.id ?? '';
    queueSel.replaceChildren();
    if (queues.length === 0) {
        queueSel.appendChild(new Option('No queues yet — click to build one', ''));
        queueSel.disabled = true;
    } else {
        for (const q of queues) {
            queueSel.appendChild(new Option(q.name, q.id));
        }
        queueSel.disabled = false;
        queueSel.value = wanted;
    }
    queueSel.title = queues.length ? 'Queue to start' : 'No queues defined yet';
}

function renderActions(running, paused, shownQueue) {
    const show = (act, on) => barEl.querySelector(`[data-act="${act}"]`).classList.toggle('hidden', !on);
    // Start stays clickable with no queues — it routes to the Queues tab so
    // a first-time user has somewhere to go.
    show('start', !running);
    show('skip', running);
    show('stop', running && !paused);
    show('resume', paused);
    barEl.querySelector('[data-act="start"]').title = shownQueue
        ? `Start "${shownQueue.name}" on this chat`
        : 'Build a queue to get started';
}
