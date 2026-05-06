/* SillyTavern-Roulette — AGPL-3.0
 *
 * Chamber tab — cylinder visualization, status line, action buttons.
 *
 * Cylinder lifecycle:
 *  - Full re-render only when the queue changes or the cylinder is missing.
 *  - When only the active slot changes, KEEP the existing SVG and animate
 *    the pivot from its current angle to the new slot's firing-position
 *    angle (via spinCylinderTo). Re-rendering on every tick would reset
 *    the rotation and kill the animation.
 *  - When responsesRemaining changes (no active-slot change), update the
 *    pip ring in place. (Pip ring lands in step 5; for step 4 we still
 *    re-render only the meta line.)
 */

import { findQueue, getChatState, getSettings } from '../../state.js';
import { startRotation, stopRotation, resumeRotation, skipCurrentSlot } from '../../events.js';
import { renderCylinder, spinCylinderTo, rotationForActiveIndex } from '../cylinder.js';

// Per-mounted-tab state.
const tabState = new WeakMap();

export function mountChamberTab(container) {
    container.innerHTML = `
        <div class="roulette-chamber-layout">
            <div class="roulette-chamber-stage" data-field="cylinder-host"></div>
            <div class="roulette-chamber-meta" data-field="meta">
                <div class="roulette-chamber-status" data-field="status"></div>
                <div class="roulette-chamber-queue-info" data-field="queue-info"></div>
            </div>
            <div class="roulette-action-row" data-field="actions">
                <button type="button" class="roulette-action roulette-action-primary" data-act="spin">
                    <i class="fa-solid fa-rotate"></i><span>Spin</span>
                </button>
                <button type="button" class="roulette-action roulette-action-info" data-act="skip">
                    <i class="fa-solid fa-forward"></i><span>Skip</span>
                </button>
                <button type="button" class="roulette-action roulette-action-stop" data-act="stop">
                    <i class="fa-solid fa-stop"></i><span>Stop</span>
                </button>
                <button type="button" class="roulette-action roulette-action-go hidden" data-act="resume">
                    <i class="fa-solid fa-play"></i><span>Resume</span>
                </button>
            </div>
            <div class="roulette-empty-hint hidden" data-field="empty-hint">
                No queue active. Pick one in <b>Queues</b> or use the Start button in the Extensions drawer.
            </div>
        </div>
    `;

    tabState.set(container, {
        lastQueueId: null,
        lastActiveSlotId: null,
        spinning: false,
    });

    container.querySelector('[data-act="spin"]').addEventListener('click', async () => {
        const state = getChatState();
        if (state.activeQueueId) {
            await skipCurrentSlot();
        } else {
            const queues = getSettings().queues;
            if (queues.length === 0) return;
            await startRotation(queues[0].id);
        }
    });
    container.querySelector('[data-act="skip"]').addEventListener('click', async () => {
        await skipCurrentSlot();
    });
    container.querySelector('[data-act="stop"]').addEventListener('click', () => {
        stopRotation();
    });
    container.querySelector('[data-act="resume"]').addEventListener('click', () => {
        resumeRotation();
    });

    refreshChamberTab(container);
}

export function refreshChamberTab(container) {
    if (!container) return;
    const ts = tabState.get(container);
    if (!ts) return;

    const host = container.querySelector('[data-field="cylinder-host"]');
    if (!host) return;

    const state = getChatState();
    const queue = state.activeQueueId ? findQueue(state.activeQueueId) : null;
    const settings = getSettings();
    // Preview the first saved queue when rotation is idle so the cylinder
    // is never empty if the user has queues defined.
    const previewQueue = queue ?? settings.queues[0] ?? null;
    const activeSlotId = queue ? state.currentSlotId : null;

    let svg = host.querySelector('.roulette-cylinder');
    const queueChanged = previewQueue?.id !== ts.lastQueueId;
    const needsFullRender = !svg || queueChanged;

    if (previewQueue) {
        if (needsFullRender) {
            host.innerHTML = '';
            // When the queue switches with rotation already in flight,
            // start with the new active slot already at firing position.
            const startIndex = activeSlotId
                ? previewQueue.slots.findIndex(s => s.id === activeSlotId)
                : -1;
            const initialAngle = rotationForActiveIndex(startIndex, previewQueue.slots.length);
            svg = renderCylinder({
                slots: previewQueue.slots ?? [],
                activeSlotId,
                mode: previewQueue.mode,
                mini: false,
                initialAngle,
                responsesRemaining: state.responsesRemaining,
                responsesAllotted: state.responsesAllotted,
            });
            host.appendChild(svg);
            ts.lastQueueId = previewQueue.id;
            ts.lastActiveSlotId = activeSlotId;
            ts.lastResponsesRemaining = state.responsesRemaining;
        } else if (activeSlotId !== ts.lastActiveSlotId) {
            // Active slot changed — animate the spin, then re-render the
            // cylinder at the new resting angle so the new active chamber
            // gets its halo and pip ring.
            const newIndex = previewQueue.slots.findIndex(s => s.id === activeSlotId);
            ts.spinning = true;
            const N = previewQueue.slots.length;
            spinCylinderTo(svg, newIndex, N, previewQueue.mode).then(() => {
                ts.spinning = false;
                const finalAngle = rotationForActiveIndex(newIndex, N);
                host.innerHTML = '';
                const newSvg = renderCylinder({
                    slots: previewQueue.slots,
                    activeSlotId,
                    mode: previewQueue.mode,
                    mini: false,
                    initialAngle: finalAngle,
                    responsesRemaining: state.responsesRemaining,
                    responsesAllotted: state.responsesAllotted,
                });
                host.appendChild(newSvg);
                triggerChamberIgnition(newSvg);
                ts.lastResponsesRemaining = state.responsesRemaining;
            });
            ts.lastActiveSlotId = activeSlotId;
        } else if (state.responsesRemaining !== ts.lastResponsesRemaining) {
            // Counter ticked — update pips in place, no re-render.
            updatePipRing(svg, ts.lastResponsesRemaining ?? state.responsesRemaining, state.responsesRemaining);
            ts.lastResponsesRemaining = state.responsesRemaining;
        }
    } else {
        host.innerHTML = `
            <div class="roulette-stage-empty">
                <i class="fa-solid fa-circle-dot"></i>
                <p>No queues defined yet.</p>
                <p class="roulette-text-muted">Build one in the <b>Queues</b> tab to load the chambers.</p>
            </div>
        `;
        ts.lastQueueId = null;
        ts.lastActiveSlotId = null;
    }

    refreshMeta(container, queue, previewQueue, state);
}

/**
 * Trigger the post-spin ignition flash on the active chamber's halo.
 * Adds a class that runs the keyframe animation, then removes it after
 * the animation completes so subsequent spins can re-trigger it.
 */
function triggerChamberIgnition(svg) {
    const active = svg.querySelector('.roulette-chamber-active');
    if (!active) return;
    active.classList.add('roulette-chamber-igniting');
    const cleanup = () => active.classList.remove('roulette-chamber-igniting');
    setTimeout(cleanup, 900);
}

/**
 * In-place pip ring update: each pip whose index >= newRemaining gets a
 * brief flash before settling into the dimmed state, so the user sees a
 * concrete "tick" the moment a response is consumed.
 */
function updatePipRing(svg, prevRemaining, newRemaining) {
    const active = svg.querySelector('.roulette-chamber-active');
    if (!active) return;
    const pips = active.querySelectorAll('.roulette-pip');
    pips.forEach((pip) => {
        const idx = Number(pip.dataset.pipIndex ?? '-1');
        const wasLit = idx < prevRemaining;
        const lit = idx < newRemaining;
        if (wasLit && !lit) {
            // Tick: flash, then dim.
            pip.classList.add('roulette-pip-tick');
            setTimeout(() => {
                pip.classList.remove('roulette-pip-tick');
                pip.classList.add('roulette-pip-dim');
                pip.setAttribute('opacity', '0.22');
            }, 280);
        } else if (!wasLit && lit) {
            pip.classList.remove('roulette-pip-dim');
            pip.setAttribute('opacity', '1');
        }
    });
}

function refreshMeta(container, queue, previewQueue, state) {
    const statusEl = container.querySelector('[data-field="status"]');
    const queueInfoEl = container.querySelector('[data-field="queue-info"]');
    const emptyHint = container.querySelector('[data-field="empty-hint"]');
    const actionRow = container.querySelector('[data-field="actions"]');
    const resumeBtn = container.querySelector('[data-act="resume"]');
    const stopBtn = container.querySelector('[data-act="stop"]');
    const skipBtn = container.querySelector('[data-act="skip"]');
    const spinBtn = container.querySelector('[data-act="spin"]');

    if (queue) {
        const slot = queue.slots.find(s => s.id === state.currentSlotId);
        const profile = slot?.profileName ?? '?';
        const left = state.responsesRemaining;
        statusEl.innerHTML = `
            <span class="roulette-status-active-dot"></span>
            <span class="roulette-status-label">${escapeHtml(profile)}</span>
            <span class="roulette-status-pill">${left} left</span>
        `;
        queueInfoEl.textContent = `${queue.name} · ${queue.mode} · ${queue.slots?.length ?? 0} chambers`;
        if (state.manuallyOverridden) {
            statusEl.innerHTML += ' <span class="roulette-status-paused">paused: manual override</span>';
        }
    } else if (previewQueue) {
        statusEl.innerHTML = '<span class="roulette-status-idle">Idle preview</span>';
        queueInfoEl.textContent = `${previewQueue.name} · ${previewQueue.mode} · ${previewQueue.slots?.length ?? 0} chambers`;
    } else {
        statusEl.innerHTML = '<span class="roulette-status-idle">No queue</span>';
        queueInfoEl.textContent = '';
    }

    const hasRotation = !!queue;
    emptyHint.classList.toggle('hidden', !!previewQueue);
    actionRow.classList.toggle('roulette-action-row-disabled', !previewQueue);
    spinBtn.querySelector('span').textContent = hasRotation ? 'Spin' : 'Start';
    spinBtn.classList.toggle('hidden', !previewQueue);
    skipBtn.classList.toggle('hidden', !hasRotation);
    stopBtn.classList.toggle('hidden', !hasRotation);
    resumeBtn.classList.toggle('hidden', !state.manuallyOverridden);
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
