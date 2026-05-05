/* SillyTavern-Roulette — AGPL-3.0
 *
 * Renders the "Roulette" block in the Extensions drawer:
 *  - list of saved queues with edit/delete
 *  - "New queue" button
 *  - "Start rotation" select + button
 *  - current rotation status line
 */

import { getSettings, deleteQueue, findQueue, getChatState } from '../state.js';
import { startRotation, stopRotation, resumeRotation, skipCurrentSlot, onRotationStateChanged } from '../events.js';
import { openQueueEditor } from './queueEditor.js';

let mounted = false;
let rootEl = null;

export function mountSettingsPanel() {
    if (mounted) return;
    const target = document.getElementById('extensions_settings');
    if (!target) {
        console.warn('[Roulette] #extensions_settings not found; settings panel not mounted');
        return;
    }
    rootEl = document.createElement('div');
    rootEl.className = 'roulette-extension roulette-settings-block';
    rootEl.innerHTML = template();
    target.appendChild(rootEl);

    rootEl.querySelector('[data-action="new-queue"]').addEventListener('click', async () => {
        const result = await openQueueEditor(null);
        if (result.saved) render();
    });
    rootEl.querySelector('[data-action="start"]').addEventListener('click', async () => {
        const sel = rootEl.querySelector('[data-field="start-queue"]');
        const queueId = sel.value;
        if (!queueId) return;
        await startRotation(queueId);
        render();
    });
    rootEl.querySelector('[data-action="stop"]').addEventListener('click', () => {
        stopRotation();
        render();
    });
    rootEl.querySelector('[data-action="resume"]').addEventListener('click', () => {
        resumeRotation();
        render();
    });
    rootEl.querySelector('[data-action="skip"]').addEventListener('click', async () => {
        await skipCurrentSlot();
        render();
    });

    onRotationStateChanged(render);
    mounted = true;
    render();
}

function render() {
    if (!rootEl) return;
    const settings = getSettings();
    const state = getChatState();

    // Queue list.
    const queueList = rootEl.querySelector('[data-field="queues"]');
    queueList.innerHTML = '';
    if (settings.queues.length === 0) {
        queueList.innerHTML = '<div class="roulette-empty">No queues yet. Click "New queue" to create one.</div>';
    } else {
        for (const queue of settings.queues) {
            const row = document.createElement('div');
            row.className = 'roulette-queue-row';
            row.innerHTML = `
                <div class="roulette-queue-name">${escapeHtml(queue.name)}</div>
                <div class="roulette-queue-meta">${queue.mode} · ${queue.slots?.length ?? 0} slot(s)</div>
                <div class="roulette-queue-actions">
                    <i class="menu_button fa-solid fa-pen-to-square" data-act="edit" title="Edit queue"></i>
                    <i class="menu_button fa-solid fa-trash-can" data-act="delete" title="Delete queue"></i>
                </div>
            `;
            row.querySelector('[data-act="edit"]').addEventListener('click', async () => {
                const r = await openQueueEditor(queue);
                if (r.saved) render();
            });
            row.querySelector('[data-act="delete"]').addEventListener('click', () => {
                if (!confirm(`Delete queue "${queue.name}"?`)) return;
                deleteQueue(queue.id);
                render();
            });
            queueList.appendChild(row);
        }
    }

    // Start dropdown.
    const startSel = rootEl.querySelector('[data-field="start-queue"]');
    const prev = startSel.value;
    startSel.innerHTML = '';
    if (settings.queues.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = '(no queues defined)';
        opt.value = '';
        startSel.appendChild(opt);
    } else {
        for (const q of settings.queues) {
            const opt = document.createElement('option');
            opt.value = q.id;
            opt.textContent = q.name;
            startSel.appendChild(opt);
        }
    }
    if (prev) startSel.value = prev;

    // Status line.
    const statusEl = rootEl.querySelector('[data-field="status"]');
    if (!state.activeQueueId) {
        statusEl.textContent = 'Rotation: off';
    } else {
        const queue = findQueue(state.activeQueueId);
        const slot = queue?.slots.find(s => s.id === state.currentSlotId);
        const name = queue?.name ?? '?';
        const profile = slot?.profileName ?? '?';
        const left = state.responsesRemaining;
        const flag = state.manuallyOverridden ? ' (paused: manual override)' : '';
        statusEl.textContent = `Rotation: ${name} · ${profile} · ${left} left${flag}`;
    }

    // Toggle action buttons.
    rootEl.querySelector('[data-action="stop"]').classList.toggle('hidden', !state.activeQueueId);
    rootEl.querySelector('[data-action="skip"]').classList.toggle('hidden', !state.activeQueueId);
    rootEl.querySelector('[data-action="resume"]').classList.toggle('hidden', !state.manuallyOverridden);
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function template() {
    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Roulette</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="roulette-status" data-field="status">Rotation: off</div>
                <div class="roulette-row-actions">
                    <select class="text_pole" data-field="start-queue"></select>
                    <button class="menu_button" data-action="start" type="button">
                        <i class="fa-solid fa-play"></i> Start
                    </button>
                    <button class="menu_button hidden" data-action="stop" type="button">
                        <i class="fa-solid fa-stop"></i> Stop
                    </button>
                    <button class="menu_button hidden" data-action="skip" type="button">
                        <i class="fa-solid fa-forward"></i> Skip
                    </button>
                    <button class="menu_button hidden" data-action="resume" type="button">
                        <i class="fa-solid fa-play"></i> Resume
                    </button>
                </div>
                <div class="roulette-section-title">Queues</div>
                <div data-field="queues" class="roulette-queues"></div>
                <div class="roulette-row-actions">
                    <button class="menu_button" data-action="new-queue" type="button">
                        <i class="fa-solid fa-plus"></i> New queue
                    </button>
                </div>
            </div>
        </div>
    `;
}
