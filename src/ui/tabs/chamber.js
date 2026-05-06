/* SillyTavern-Roulette — AGPL-3.0
 *
 * Chamber tab — cylinder visualization, status line, action buttons.
 * Subscribes to rotation state changes (via the modal's onRotationStateChanged
 * subscription) and re-renders on every refresh call.
 */

import { findQueue, getChatState, getSettings } from '../../state.js';
import { startRotation, stopRotation, resumeRotation, skipCurrentSlot } from '../../events.js';
import { renderCylinder } from '../cylinder.js';

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

    container.querySelector('[data-act="spin"]').addEventListener('click', async () => {
        const state = getChatState();
        if (state.activeQueueId) {
            // Spin = force-advance the rotation
            await skipCurrentSlot();
        } else {
            // Spin with no queue = start the first available queue
            const queues = getSettings().queues;
            if (queues.length === 0) return;
            await startRotation(queues[0].id);
        }
        refreshChamberTab(container);
    });
    container.querySelector('[data-act="skip"]').addEventListener('click', async () => {
        await skipCurrentSlot();
        refreshChamberTab(container);
    });
    container.querySelector('[data-act="stop"]').addEventListener('click', () => {
        stopRotation();
        refreshChamberTab(container);
    });
    container.querySelector('[data-act="resume"]').addEventListener('click', () => {
        resumeRotation();
        refreshChamberTab(container);
    });

    refreshChamberTab(container);
}

export function refreshChamberTab(container) {
    if (!container) return;
    const host = container.querySelector('[data-field="cylinder-host"]');
    const statusEl = container.querySelector('[data-field="status"]');
    const queueInfoEl = container.querySelector('[data-field="queue-info"]');
    const emptyHint = container.querySelector('[data-field="empty-hint"]');
    const actionRow = container.querySelector('[data-field="actions"]');
    const resumeBtn = container.querySelector('[data-act="resume"]');
    const stopBtn = container.querySelector('[data-act="stop"]');
    const skipBtn = container.querySelector('[data-act="skip"]');
    const spinBtn = container.querySelector('[data-act="spin"]');
    if (!host) return;

    const state = getChatState();
    const queue = state.activeQueueId ? findQueue(state.activeQueueId) : null;
    const settings = getSettings();
    // If no active rotation, fall back to previewing the first saved queue
    // so the cylinder is never empty when queues exist.
    const previewQueue = queue ?? settings.queues[0] ?? null;

    host.innerHTML = '';
    if (previewQueue) {
        const svg = renderCylinder({
            slots: previewQueue.slots ?? [],
            activeSlotId: queue ? state.currentSlotId : null,
            mode: previewQueue.mode,
            mini: false,
        });
        host.appendChild(svg);
    } else {
        host.innerHTML = `
            <div class="roulette-stage-empty">
                <i class="fa-solid fa-circle-dot"></i>
                <p>No queues defined yet.</p>
                <p class="roulette-text-muted">Build one in the <b>Queues</b> tab to load the chambers.</p>
            </div>
        `;
    }

    // Status line + meta.
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

    // Action visibility / labels.
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
