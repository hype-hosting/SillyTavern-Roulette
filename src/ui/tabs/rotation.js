/* SillyTavern-Roulette — AGPL-3.0
 *
 * Rotation tab — what is running right now, and what has run so far.
 *
 * v2.0 folded the old History tab in here. The cylinder used to fill this
 * pane on its own; a dot strip is a fraction of its height, and a tab
 * holding nothing but a strip and two buttons read as empty. The pick log
 * is also the thing users actually wanted next to the live status, so the
 * merge fixes a layout problem and a navigation one at once.
 *
 * Sections, top to bottom:
 *   - dot strip + current profile + queue meta
 *   - actions (Start when idle; Skip / Stop / Resume when running)
 *   - auto-start binding for the current character (hidden in group chats)
 *   - recent picks: trail strip + newest-first rows
 */

import { findQueue, getChatState, getSettings, preferredQueue, setLastQueueId } from '../../state.js';
import {
    startRotation,
    stopRotation,
    resumeRotation,
    skipCurrentSlot,
    reevaluateAutoActivation,
} from '../../events.js';
import { getCurrentCharacter, getBoundQueueId, setBinding, clearBinding } from '../../characterBinding.js';
import { mountDotStrip } from '../dotStrip.js';
import { colorForProfile } from '../profileColors.js';

const TRAIL_LENGTH = 16;
const LIST_CAP = 100;

export function mountRotationTab(container) {
    container.innerHTML = `
        <div class="roulette-rot">

            <div class="roulette-rot-head">
                <div class="roulette-rot-strip" data-field="dots"></div>
                <div class="roulette-rot-status">
                    <div class="roulette-rot-profile" data-field="profile"></div>
                    <div class="roulette-rot-meta" data-field="meta"></div>
                </div>
            </div>

            <div class="roulette-rot-controls">
                <select class="roulette-select" data-field="queue" aria-label="Queue to start"></select>
                <button type="button" class="roulette-action roulette-action-go" data-act="start">
                    <i class="fa-solid fa-play"></i><span>Start</span>
                </button>
                <button type="button" class="roulette-action" data-act="skip">
                    <i class="fa-solid fa-forward"></i><span>Skip</span>
                </button>
                <button type="button" class="roulette-action roulette-action-stop" data-act="stop">
                    <i class="fa-solid fa-stop"></i><span>Stop</span>
                </button>
                <button type="button" class="roulette-action roulette-action-go" data-act="resume">
                    <i class="fa-solid fa-play"></i><span>Resume</span>
                </button>
            </div>

            <label class="roulette-rot-bind" data-field="bind-row">
                <span class="roulette-rot-bind-label">
                    Auto-start for <b data-field="bind-character"></b>
                </span>
                <select class="roulette-select" data-field="bind-select"></select>
            </label>

            <div class="roulette-rot-history">
                <div class="roulette-section-title-row">
                    <div class="roulette-section-title">Recent picks</div>
                    <div class="roulette-section-value" data-field="count"></div>
                </div>
                <div class="roulette-trail" data-field="trail"></div>
                <div class="roulette-rows" data-field="list"></div>
                <div class="roulette-empty" data-field="history-empty">
                    No responses yet in this chat. Every message the rotation produces gets logged here.
                </div>
            </div>

        </div>
    `;

    const queueSel = container.querySelector('[data-field="queue"]');
    queueSel.addEventListener('change', () => {
        setLastQueueId(queueSel.value || null);
        refreshRotationTab(container);
    });

    container.querySelector('[data-act="start"]').addEventListener('click', async () => {
        const queueId = queueSel.value;
        if (!queueId) return;
        const result = await startRotation(queueId);
        if (!result.ok && typeof toastr !== 'undefined') toastr.error(`Roulette: ${result.error}`);
    });
    container.querySelector('[data-act="skip"]').addEventListener('click', async () => {
        const result = await skipCurrentSlot();
        if (!result.ok && typeof toastr !== 'undefined') toastr.warning(`Roulette: ${result.error}`);
    });
    container.querySelector('[data-act="stop"]').addEventListener('click', () => stopRotation());
    container.querySelector('[data-act="resume"]').addEventListener('click', () => resumeRotation());

    container.querySelector('[data-field="bind-select"]').addEventListener('change', async (e) => {
        const character = getCurrentCharacter();
        if (!character) return;
        const queueId = e.target.value;
        if (queueId) setBinding(character.key, queueId);
        else clearBinding(character.key);
        // Apply the binding to the chat we're sitting in, not just to future
        // loads — otherwise setting a binding here looks like it did nothing.
        await reevaluateAutoActivation();
        refreshRotationTab(container);
    });

    refreshRotationTab(container);
}

export function refreshRotationTab(container) {
    if (!container) return;
    const state = getChatState();
    const activeQueue = state.activeQueueId ? findQueue(state.activeQueueId) : null;
    const running = !!activeQueue;
    const paused = running && !!state.manuallyOverridden;
    const shownQueue = activeQueue ?? preferredQueue();

    mountDotStrip(container.querySelector('[data-field="dots"]'), {
        slots: shownQueue?.slots ?? [],
        activeSlotId: running ? state.currentSlotId : null,
        mode: shownQueue?.mode ?? 'sequential',
        variant: 'panel',
        responsesRemaining: state.responsesRemaining,
        responsesAllotted: state.responsesAllotted,
        paused,
        idle: !running,
    });

    refreshStatus(container, activeQueue, shownQueue, state, running, paused);
    refreshControls(container, shownQueue, running, paused);
    refreshBindRow(container);
    refreshHistory(container, state);
}

function refreshStatus(container, activeQueue, shownQueue, state, running, paused) {
    const profileEl = container.querySelector('[data-field="profile"]');
    const metaEl = container.querySelector('[data-field="meta"]');

    if (running) {
        const slot = activeQueue.slots.find(s => s.id === state.currentSlotId);
        const profile = slot?.profileName || 'unassigned slot';
        profileEl.textContent = profile;
        // Hash the REAL profile name only — hashing the placeholder string
        // would light the dot in a vivid colour that reads as a profile.
        profileEl.style.setProperty('--dot-color', colorForProfile(slot?.profileName) ?? 'var(--roulette-text-muted)');
        profileEl.classList.remove('roulette-rot-profile-idle');
        metaEl.textContent = paused
            ? `${activeQueue.name} · paused by a manual profile switch`
            : `${activeQueue.name} · ${modeLabel(activeQueue.mode)} · ${state.responsesRemaining} left`;
        return;
    }

    profileEl.classList.add('roulette-rot-profile-idle');
    profileEl.style.removeProperty('--dot-color');
    if (shownQueue) {
        profileEl.textContent = 'Not running';
        metaEl.textContent = `${shownQueue.name} · ${modeLabel(shownQueue.mode)} · ${shownQueue.slots?.length ?? 0} slots`;
    } else {
        profileEl.textContent = 'No queues yet';
        metaEl.textContent = 'Build one in the Queues tab to get started.';
    }
}

function refreshControls(container, shownQueue, running, paused) {
    const queueSel = container.querySelector('[data-field="queue"]');
    const show = (act, on) => container.querySelector(`[data-act="${act}"]`).classList.toggle('hidden', !on);

    show('start', !running);
    show('skip', running);
    show('stop', running && !paused);
    show('resume', paused);

    queueSel.classList.toggle('hidden', running);
    if (running) return;

    // Rebuilt every refresh: queues can be created or deleted in the next tab
    // over while this one is mounted.
    const queues = getSettings().queues;
    queueSel.replaceChildren();
    if (queues.length === 0) {
        queueSel.appendChild(new Option('No queues defined yet', ''));
        queueSel.disabled = true;
    } else {
        for (const q of queues) queueSel.appendChild(new Option(q.name, q.id));
        queueSel.disabled = false;
        queueSel.value = shownQueue?.id ?? '';
    }
    container.querySelector('[data-act="start"]').disabled = queues.length === 0;
}

/**
 * Character-binding control. Hidden entirely when bindings don't apply —
 * group chats and "no character loaded" both yield null from
 * getCurrentCharacter().
 */
function refreshBindRow(container) {
    const row = container.querySelector('[data-field="bind-row"]');
    const select = container.querySelector('[data-field="bind-select"]');
    const nameEl = container.querySelector('[data-field="bind-character"]');

    const character = getCurrentCharacter();
    if (!character) {
        row.classList.add('hidden');
        return;
    }
    row.classList.remove('hidden');
    nameEl.textContent = character.name;

    const bound = getBoundQueueId(character.key) ?? '';
    const queues = getSettings().queues;

    select.replaceChildren();
    select.appendChild(new Option(queues.length ? 'Nothing — start manually' : 'No queues defined yet', ''));
    for (const q of queues) select.appendChild(new Option(q.name, q.id));

    // A binding can outlive its queue (deleteQueue prunes, but an import or
    // a hand-edited settings file can still leave one dangling). Show it
    // rather than silently snapping the control back to "Nothing".
    if (bound && !queues.some(q => q.id === bound)) {
        select.appendChild(new Option('Missing queue — pick another', bound));
    }
    select.value = bound;
    select.disabled = queues.length === 0;
}

function refreshHistory(container, state) {
    const trailEl = container.querySelector('[data-field="trail"]');
    const listEl = container.querySelector('[data-field="list"]');
    const emptyEl = container.querySelector('[data-field="history-empty"]');
    const countEl = container.querySelector('[data-field="count"]');

    const history = Array.isArray(state.history) ? state.history : [];
    countEl.textContent = history.length ? `${history.length}` : '';

    if (history.length === 0) {
        trailEl.replaceChildren();
        listEl.replaceChildren();
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');

    // Trail: last TRAIL_LENGTH picks, oldest left, newest right, padded so
    // the strip keeps a constant width as a chat fills up.
    const trailEntries = history.slice(-TRAIL_LENGTH);
    const trailNodes = [];
    for (let i = trailEntries.length; i < TRAIL_LENGTH; i++) {
        const dot = document.createElement('span');
        dot.className = 'roulette-trail-dot roulette-trail-dot-empty';
        trailNodes.push(dot);
    }
    trailEntries.forEach((entry, i) => {
        const dot = document.createElement('span');
        dot.className = `roulette-trail-dot${i === trailEntries.length - 1 ? ' roulette-trail-dot-newest' : ''}`;
        const c = colorForProfile(entry.profileName);
        if (c) dot.style.backgroundColor = c;
        dot.title = `#${entry.messageId} · ${entry.profileName ?? '?'} · ${formatTime(entry.timestamp)}`;
        trailNodes.push(dot);
    });
    trailEl.replaceChildren(...trailNodes);

    // Detail list, newest-first, capped so a long chat doesn't build 2000 rows.
    const recent = history.slice(-LIST_CAP).reverse();
    const rows = recent.map(entry => {
        const row = document.createElement('div');
        row.className = 'roulette-row';

        const dot = document.createElement('span');
        dot.className = 'roulette-row-dot';
        dot.style.backgroundColor = colorForProfile(entry.profileName) ?? 'var(--roulette-text-dim)';

        const id = document.createElement('span');
        id.className = 'roulette-row-id';
        id.textContent = `#${entry.messageId}`;

        const name = document.createElement('span');
        name.className = 'roulette-row-name';
        name.textContent = entry.profileName ?? '?';

        const time = document.createElement('span');
        time.className = 'roulette-row-time';
        time.textContent = formatTime(entry.timestamp);

        row.append(dot, id, name, time);
        return row;
    });
    if (history.length > LIST_CAP) {
        const note = document.createElement('div');
        note.className = 'roulette-rows-note';
        note.textContent = `Showing the newest ${LIST_CAP} of ${history.length}.`;
        rows.push(note);
    }
    listEl.replaceChildren(...rows);
}

function modeLabel(mode) {
    return mode === 'weighted-random' ? 'weighted random' : 'sequential';
}

function formatTime(ts) {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
