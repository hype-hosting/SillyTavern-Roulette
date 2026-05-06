/* SillyTavern-Roulette — AGPL-3.0
 *
 * Queues tab — card grid + inline editor. Editor wiring lands in step 7;
 * this step ships the grid, mini-cylinder previews per card, and import
 * affordance. Cards are clickable to edit, with hover-revealed icons for
 * Start / Duplicate / Export / Delete. Active queue card is outlined in
 * brass and gets the breathing glow treatment.
 */

import { getSettings, deleteQueue, getChatState, upsertQueue } from '../../state.js';
import { startRotation, stopRotation, onRotationStateChanged } from '../../events.js';
import { renderCylinder } from '../cylinder.js';
import { exportQueue, exportAllQueues, importQueueFile } from '../../exportImport.js';
import { openQueueEditor } from '../queueEditor.js';

const tabState = new WeakMap();

export function mountQueuesTab(container) {
    container.innerHTML = `
        <div class="roulette-queues-layout">
            <div class="roulette-queues-toolbar">
                <button type="button" class="roulette-action roulette-action-primary" data-act="new">
                    <i class="fa-solid fa-plus"></i><span>New queue</span>
                </button>
                <button type="button" class="roulette-action" data-act="import">
                    <i class="fa-solid fa-file-import"></i><span>Import…</span>
                </button>
                <button type="button" class="roulette-action" data-act="export-all">
                    <i class="fa-solid fa-file-export"></i><span>Export all</span>
                </button>
                <input type="file" accept="application/json,.json" class="hidden" data-field="import-input" />
            </div>
            <div class="roulette-queue-grid" data-field="grid"></div>
            <div class="roulette-queues-empty hidden" data-field="empty-state">
                <i class="fa-solid fa-layer-group"></i>
                <p>No queues yet.</p>
                <p class="roulette-text-muted">Click <b>New queue</b> to load your first cylinder.</p>
            </div>
        </div>
    `;

    container.querySelector('[data-act="new"]').addEventListener('click', async () => {
        const result = await openQueueEditor(null);
        if (result.saved) refreshQueuesTab(container);
    });
    container.querySelector('[data-act="export-all"]').addEventListener('click', () => {
        if (getSettings().queues.length === 0) {
            if (typeof toastr !== 'undefined') toastr.info('No queues to export.');
            return;
        }
        exportAllQueues();
    });
    const importInput = container.querySelector('[data-field="import-input"]');
    container.querySelector('[data-act="import"]').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const result = await importQueueFile(file);
            if (typeof toastr !== 'undefined') {
                if (result.imported > 0) toastr.success(`Imported ${result.imported} queue(s).`);
                if (result.rejected.length > 0) {
                    toastr.warning(`${result.rejected.length} queue(s) rejected: ${result.rejected.map(r => r.name).join(', ')}`);
                }
            }
            refreshQueuesTab(container);
        } catch (err) {
            if (typeof toastr !== 'undefined') toastr.error(`Import failed: ${err.message}`);
            console.error('[Roulette] import failed:', err);
        } finally {
            importInput.value = '';
        }
    });

    tabState.set(container, { onModalClose: null });
    refreshQueuesTab(container);
}

export function refreshQueuesTab(container) {
    if (!container) return;
    const grid = container.querySelector('[data-field="grid"]');
    const empty = container.querySelector('[data-field="empty-state"]');
    if (!grid) return;

    const settings = getSettings();
    const state = getChatState();
    const activeQueueId = state.activeQueueId;

    grid.innerHTML = '';
    if (settings.queues.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    for (const queue of settings.queues) {
        grid.appendChild(buildQueueCard(queue, activeQueueId === queue.id, container));
    }
}

function buildQueueCard(queue, isActive, tabContainer) {
    const card = document.createElement('div');
    card.className = `roulette-queue-card ${isActive ? 'roulette-queue-card-active' : ''}`;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    const previewHost = document.createElement('div');
    previewHost.className = 'roulette-queue-card-preview';
    const svg = renderCylinder({
        slots: queue.slots ?? [],
        activeSlotId: null,
        mode: queue.mode,
        mini: true,
    });
    previewHost.appendChild(svg);
    card.appendChild(previewHost);

    const meta = document.createElement('div');
    meta.className = 'roulette-queue-card-meta';
    meta.innerHTML = `
        <div class="roulette-queue-card-name" title="${escapeHtml(queue.name)}">${escapeHtml(queue.name)}</div>
        <div class="roulette-queue-card-tags">
            <span class="roulette-tag roulette-tag-mode">${queue.mode}</span>
            <span class="roulette-tag">${queue.slots?.length ?? 0} chambers</span>
            ${isActive ? '<span class="roulette-tag roulette-tag-active">active</span>' : ''}
        </div>
    `;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'roulette-queue-card-actions';
    actions.innerHTML = `
        <button class="roulette-icon-btn roulette-icon-btn-primary" data-card-act="${isActive ? 'stop' : 'start'}" title="${isActive ? 'Stop rotation' : 'Start rotation on this chat'}">
            <i class="fa-solid ${isActive ? 'fa-stop' : 'fa-play'}"></i>
        </button>
        <button class="roulette-icon-btn" data-card-act="edit" title="Edit queue">
            <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="roulette-icon-btn" data-card-act="duplicate" title="Duplicate">
            <i class="fa-solid fa-copy"></i>
        </button>
        <button class="roulette-icon-btn" data-card-act="export" title="Export as JSON">
            <i class="fa-solid fa-file-export"></i>
        </button>
        <button class="roulette-icon-btn roulette-icon-btn-stop" data-card-act="delete" title="Delete queue">
            <i class="fa-solid fa-trash-can"></i>
        </button>
    `;
    card.appendChild(actions);

    // Card body click → edit (clicks on the action buttons stop propagation).
    card.addEventListener('click', async (e) => {
        if (e.target.closest('.roulette-queue-card-actions')) return;
        const result = await openQueueEditor(queue);
        if (result.saved) refreshQueuesTab(tabContainer);
    });
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            card.click();
        }
    });

    actions.addEventListener('click', (e) => e.stopPropagation());

    actions.querySelector('[data-card-act="start"]')?.addEventListener('click', async () => {
        await startRotation(queue.id);
        refreshQueuesTab(tabContainer);
    });
    actions.querySelector('[data-card-act="stop"]')?.addEventListener('click', () => {
        stopRotation();
        refreshQueuesTab(tabContainer);
    });
    actions.querySelector('[data-card-act="edit"]').addEventListener('click', async () => {
        const result = await openQueueEditor(queue);
        if (result.saved) refreshQueuesTab(tabContainer);
    });
    actions.querySelector('[data-card-act="duplicate"]').addEventListener('click', () => {
        const dup = structuredClone(queue);
        dup.id = uuid();
        dup.name = `${queue.name} (copy)`;
        if (Array.isArray(dup.slots)) {
            dup.slots = dup.slots.map(s => ({ ...s, id: uuid() }));
        }
        upsertQueue(dup);
        refreshQueuesTab(tabContainer);
    });
    actions.querySelector('[data-card-act="export"]').addEventListener('click', () => {
        exportQueue(queue);
    });
    actions.querySelector('[data-card-act="delete"]').addEventListener('click', () => {
        if (!confirm(`Delete queue "${queue.name}"?`)) return;
        deleteQueue(queue.id);
        refreshQueuesTab(tabContainer);
    });

    return card;
}

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'q-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
