/* SillyTavern-Roulette — AGPL-3.0
 *
 * Queues tab. Two views inside this single tab pane:
 *   'grid' — card grid + toolbar (default)
 *   'edit' — embedded editor (renderEditorInto)
 *
 * Switching is in-pane; editing replaces the right pane content rather
 * than stacking a popup over the modal. Save / Back returns to the grid.
 */

import { getSettings, deleteQueue, getChatState, upsertQueue } from '../../state.js';
import { startRotation, stopRotation, reevaluateAutoActivation } from '../../events.js';
import { bindingCountForQueue } from '../../characterBinding.js';
import { openBindingPicker } from '../bindingPicker.js';
import { renderCylinder } from '../cylinder.js';
import { exportQueue, exportAllQueues, importQueueFile } from '../../exportImport.js';
import { renderEditorInto } from '../queueEditor.js';
import { cleanupManagedPresetsForQueue } from '../../sampling.js';

const tabState = new WeakMap();

export function mountQueuesTab(container) {
    container.innerHTML = `
        <div class="roulette-queues-pane" data-field="pane"></div>
    `;
    tabState.set(container, { view: 'grid', editingQueueId: null });
    renderGridView(container);
}

export function refreshQueuesTab(container) {
    if (!container) return;
    const ts = tabState.get(container);
    if (!ts) return;
    if (ts.view === 'grid') renderGridView(container);
    // edit view manages its own state — refresh would lose unsaved edits
}

function getPane(container) {
    return container.querySelector('[data-field="pane"]');
}

function renderGridView(container) {
    const ts = tabState.get(container);
    ts.view = 'grid';
    ts.editingQueueId = null;
    const pane = getPane(container);

    pane.innerHTML = `
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

    pane.querySelector('[data-act="new"]').addEventListener('click', () => {
        renderEditView(container, null);
    });
    pane.querySelector('[data-act="export-all"]').addEventListener('click', () => {
        if (getSettings().queues.length === 0) {
            if (typeof toastr !== 'undefined') toastr.info('No queues to export.');
            return;
        }
        exportAllQueues();
    });
    const importInput = pane.querySelector('[data-field="import-input"]');
    pane.querySelector('[data-act="import"]').addEventListener('click', () => importInput.click());
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
            renderGridView(container);
        } catch (err) {
            if (typeof toastr !== 'undefined') toastr.error(`Import failed: ${err.message}`);
            console.error('[Roulette] import failed:', err);
        } finally {
            importInput.value = '';
        }
    });

    populateGrid(container);
}

function populateGrid(container) {
    const pane = getPane(container);
    const grid = pane.querySelector('[data-field="grid"]');
    const empty = pane.querySelector('[data-field="empty-state"]');
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

function renderEditView(container, queue) {
    const ts = tabState.get(container);
    ts.view = 'edit';
    ts.editingQueueId = queue?.id ?? null;
    const pane = getPane(container);
    pane.innerHTML = '';
    pane.classList.add('roulette-queues-editing');

    const editorHost = document.createElement('div');
    editorHost.className = 'roulette-editor-host';
    pane.appendChild(editorHost);

    renderEditorInto(editorHost, queue, {
        onSave: () => {
            pane.classList.remove('roulette-queues-editing');
            renderGridView(container);
        },
        onCancel: () => {
            pane.classList.remove('roulette-queues-editing');
            renderGridView(container);
        },
    });
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
    const hasTuning = (queue.slots ?? []).some(s => s.tuning?.enabled);
    const boundCount = bindingCountForQueue(queue.id);
    meta.innerHTML = `
        <div class="roulette-queue-card-name" title="${escapeHtml(queue.name)}">${escapeHtml(queue.name)}</div>
        <div class="roulette-queue-card-tags">
            <span class="roulette-tag roulette-tag-mode">${queue.mode}</span>
            <span class="roulette-tag">${queue.slots?.length ?? 0} chambers</span>
            ${hasTuning ? '<span class="roulette-tag roulette-tag-tuned" title="Has inline sampler tuning"><i class="fa-solid fa-sliders"></i> tuned</span>' : ''}
            ${boundCount ? `<span class="roulette-tag roulette-tag-bound" title="Auto-starts for ${boundCount} character(s)"><i class="fa-solid fa-users"></i> ${boundCount}</span>` : ''}
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
        <button class="roulette-icon-btn" data-card-act="bind" title="Auto-start for characters…">
            <i class="fa-solid fa-users"></i>
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

    card.addEventListener('click', (e) => {
        if (e.target.closest('.roulette-queue-card-actions')) return;
        renderEditView(tabContainer, queue);
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
        populateGrid(tabContainer);
    });
    actions.querySelector('[data-card-act="stop"]')?.addEventListener('click', () => {
        stopRotation();
        populateGrid(tabContainer);
    });
    actions.querySelector('[data-card-act="edit"]').addEventListener('click', () => {
        renderEditView(tabContainer, queue);
    });
    actions.querySelector('[data-card-act="bind"]').addEventListener('click', async () => {
        const changed = await openBindingPicker(queue);
        if (!changed) return;
        // If one of the characters just bound is the one we're chatting with,
        // apply it to this chat now instead of waiting for a reload.
        await reevaluateAutoActivation();
        populateGrid(tabContainer);
    });
    actions.querySelector('[data-card-act="duplicate"]').addEventListener('click', () => {
        const dup = structuredClone(queue);
        dup.id = uuid();
        dup.name = `${queue.name} (copy)`;
        if (Array.isArray(dup.slots)) {
            dup.slots = dup.slots.map(s => ({ ...s, id: uuid() }));
        }
        upsertQueue(dup);
        populateGrid(tabContainer);
    });
    actions.querySelector('[data-card-act="export"]').addEventListener('click', () => {
        exportQueue(queue);
    });
    actions.querySelector('[data-card-act="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete queue "${queue.name}"?`)) return;
        // Clean up any sampler presets Roulette manages for this queue's
        // slots before forgetting the queue. Best-effort — failures here
        // log but don't block deletion.
        try { await cleanupManagedPresetsForQueue(queue); } catch (_) { /* ignore */ }
        deleteQueue(queue.id);
        populateGrid(tabContainer);
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
