/* SillyTavern-Roulette — AGPL-3.0
 *
 * Renders the "Roulette" block in the Extensions drawer:
 *  - status line
 *  - start/stop/skip/resume controls
 *  - list of saved queues with edit/export/delete
 *  - new queue / export all / import
 *  - per-chat history (collapsible)
 */

import { getSettings, deleteQueue, findQueue, getChatState } from '../state.js';
import { startRotation, stopRotation, resumeRotation, skipCurrentSlot, onRotationStateChanged } from '../events.js';
import { openQueueEditor } from './queueEditor.js';
import { exportQueue, exportAllQueues, importQueueFile } from '../exportImport.js';

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
    rootEl.querySelector('[data-action="export-all"]').addEventListener('click', () => {
        const settings = getSettings();
        if (settings.queues.length === 0) {
            if (typeof toastr !== 'undefined') toastr.info('No queues to export.');
            return;
        }
        exportAllQueues();
    });
    const importInput = rootEl.querySelector('[data-field="import-input"]');
    rootEl.querySelector('[data-action="import"]').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const result = await importQueueFile(file);
            if (typeof toastr !== 'undefined') {
                if (result.imported > 0) {
                    toastr.success(`Imported ${result.imported} queue(s).`);
                }
                if (result.rejected.length > 0) {
                    toastr.warning(`${result.rejected.length} queue(s) rejected: ${result.rejected.map(r => r.name).join(', ')}`);
                }
            }
            render();
        } catch (err) {
            if (typeof toastr !== 'undefined') toastr.error(`Import failed: ${err.message}`);
            console.error('[Roulette] import failed:', err);
        } finally {
            // Allow the same file to be re-imported later.
            importInput.value = '';
        }
    });

    onRotationStateChanged(render);
    mounted = true;
    render();
}

function render() {
    if (!rootEl) return;
    const settings = getSettings();
    const state = getChatState();

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
                    <i class="menu_button fa-solid fa-download" data-act="export" title="Export queue as JSON"></i>
                    <i class="menu_button fa-solid fa-trash-can" data-act="delete" title="Delete queue"></i>
                </div>
            `;
            row.querySelector('[data-act="edit"]').addEventListener('click', async () => {
                const r = await openQueueEditor(queue);
                if (r.saved) render();
            });
            row.querySelector('[data-act="export"]').addEventListener('click', () => {
                exportQueue(queue);
            });
            row.querySelector('[data-act="delete"]').addEventListener('click', () => {
                if (!confirm(`Delete queue "${queue.name}"?`)) return;
                deleteQueue(queue.id);
                render();
            });
            queueList.appendChild(row);
        }
    }

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

    rootEl.querySelector('[data-action="stop"]').classList.toggle('hidden', !state.activeQueueId);
    rootEl.querySelector('[data-action="skip"]').classList.toggle('hidden', !state.activeQueueId);
    rootEl.querySelector('[data-action="resume"]').classList.toggle('hidden', !state.manuallyOverridden);

    renderHistory(state);
}

function renderHistory(state) {
    const historyEl = rootEl.querySelector('[data-field="history"]');
    const countEl = rootEl.querySelector('[data-field="history-count"]');
    const history = Array.isArray(state.history) ? state.history : [];
    countEl.textContent = String(history.length);
    if (history.length === 0) {
        historyEl.innerHTML = '<div class="roulette-empty">No messages logged yet for this chat.</div>';
        return;
    }
    const recent = history.slice().reverse().slice(0, 100);
    historyEl.innerHTML = recent.map(entry => {
        const time = formatTime(entry.timestamp);
        return `<div class="roulette-history-row">
            <span class="roulette-history-id">#${entry.messageId}</span>
            <span class="roulette-history-profile">${escapeHtml(entry.profileName ?? '?')}</span>
            <span class="roulette-history-time">${time}</span>
        </div>`;
    }).join('');
    if (history.length > recent.length) {
        historyEl.innerHTML += `<div class="roulette-empty">Showing newest ${recent.length} of ${history.length}.</div>`;
    }
}

function formatTime(ts) {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString();
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
                    <button class="menu_button" data-action="export-all" type="button" title="Export every queue as a single JSON file">
                        <i class="fa-solid fa-file-export"></i> Export all
                    </button>
                    <button class="menu_button" data-action="import" type="button" title="Import queues from a JSON file">
                        <i class="fa-solid fa-file-import"></i> Import
                    </button>
                    <input type="file" accept="application/json,.json" class="hidden" data-field="import-input" />
                </div>
                <details class="roulette-history-drawer">
                    <summary class="roulette-section-title">
                        Current chat history (<span data-field="history-count">0</span>)
                    </summary>
                    <div data-field="history" class="roulette-history"></div>
                </details>
            </div>
        </div>
    `;
}
