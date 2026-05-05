/* SillyTavern-Roulette — AGPL-3.0
 *
 * Queue editor modal. Uses ST's Popup class for theme-correct styling and
 * focus management. Supports both 'sequential' and 'weighted-random' modes;
 * slots reorder via Up/Down buttons (drag-to-reorder is v2).
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../scripts/popup.js';
import { listProfileNames } from '../profileSwitcher.js';
import { upsertQueue } from '../state.js';
import { validateQueue } from '../rotation.js';

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'q-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

function defaultSlot() {
    return {
        id: uuid(),
        profileName: '',
        countMode: 'fixed',
        fixedCount: 3,
        minCount: 2,
        maxCount: 5,
        weight: 1,
    };
}

function defaultQueue() {
    return {
        id: uuid(),
        name: 'New Queue',
        mode: 'sequential',
        slots: [defaultSlot()],
        noRepeatInRow: true,
        weightedRunCount: { mode: 'fixed', fixed: 1 },
    };
}

/**
 * Open the editor for a new or existing queue.
 *
 * @param {object|null} initialQueue null = new queue
 * @returns {Promise<{saved: boolean, queue: object|null}>}
 */
export async function openQueueEditor(initialQueue = null) {
    const queue = initialQueue
        ? structuredClone(initialQueue)
        : defaultQueue();

    const root = document.createElement('div');
    root.className = 'roulette-extension roulette-queue-editor';
    root.innerHTML = template();

    // Initial population.
    const nameInput = root.querySelector('[data-field="name"]');
    const modeSelect = root.querySelector('[data-field="mode"]');
    const slotsContainer = root.querySelector('[data-field="slots"]');
    const addSlotBtn = root.querySelector('[data-action="add-slot"]');
    const wrFooter = root.querySelector('[data-field="weighted-footer"]');
    const noRepeatToggle = root.querySelector('[data-field="no-repeat"]');
    const wrCountModeSel = root.querySelector('[data-field="wr-count-mode"]');
    const wrFixed = root.querySelector('[data-field="wr-fixed"]');
    const wrMin = root.querySelector('[data-field="wr-min"]');
    const wrMax = root.querySelector('[data-field="wr-max"]');

    nameInput.value = queue.name ?? '';
    modeSelect.value = queue.mode ?? 'sequential';
    noRepeatToggle.checked = !!queue.noRepeatInRow;
    const wrc = queue.weightedRunCount ?? { mode: 'fixed', fixed: 1 };
    wrCountModeSel.value = wrc.mode ?? 'fixed';
    wrFixed.value = wrc.fixed ?? 1;
    wrMin.value = wrc.min ?? 1;
    wrMax.value = wrc.max ?? 3;

    function renderSlots() {
        slotsContainer.innerHTML = '';
        queue.slots.forEach((slot, i) => {
            slotsContainer.appendChild(slotRow(slot, i, queue.mode, () => {
                queue.slots.splice(i, 1);
                if (queue.slots.length === 0) queue.slots.push(defaultSlot());
                renderSlots();
            }, () => {
                if (i <= 0) return;
                const tmp = queue.slots[i - 1];
                queue.slots[i - 1] = queue.slots[i];
                queue.slots[i] = tmp;
                renderSlots();
            }, () => {
                if (i >= queue.slots.length - 1) return;
                const tmp = queue.slots[i + 1];
                queue.slots[i + 1] = queue.slots[i];
                queue.slots[i] = tmp;
                renderSlots();
            }));
        });
    }

    function syncModeUI() {
        wrFooter.classList.toggle('hidden', modeSelect.value !== 'weighted-random');
        renderSlots();
    }

    addSlotBtn.addEventListener('click', () => {
        queue.slots.push(defaultSlot());
        renderSlots();
    });
    modeSelect.addEventListener('change', () => {
        queue.mode = modeSelect.value;
        syncModeUI();
    });

    syncModeUI();

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Save',
        cancelButton: 'Cancel',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        return { saved: false, queue: null };
    }

    // Read back into the queue object.
    queue.name = nameInput.value.trim() || 'Queue';
    queue.mode = modeSelect.value;
    queue.noRepeatInRow = noRepeatToggle.checked;
    queue.weightedRunCount = readWeightedRunCount(wrCountModeSel, wrFixed, wrMin, wrMax);

    // Read each slot row's current values (the row inputs mutate in place
    // via change handlers, but read them once more here to be safe).
    queue.slots.forEach((slot, i) => {
        const row = slotsContainer.children[i];
        if (!row) return;
        slot.profileName = row.querySelector('[data-slot-field="profile"]').value.trim();
        slot.countMode = row.querySelector('[data-slot-field="countMode"]')?.value ?? slot.countMode;
        slot.fixedCount = numOr(row.querySelector('[data-slot-field="fixedCount"]')?.value, 1);
        slot.minCount = numOr(row.querySelector('[data-slot-field="minCount"]')?.value, 1);
        slot.maxCount = numOr(row.querySelector('[data-slot-field="maxCount"]')?.value, 3);
        slot.weight = numOr(row.querySelector('[data-slot-field="weight"]')?.value, 1);
    });

    const errors = validateQueue(queue);
    if (errors.length) {
        if (typeof toastr !== 'undefined') {
            toastr.error('Cannot save queue:\n' + errors.join('\n'));
        }
        return { saved: false, queue: null };
    }

    upsertQueue(queue);
    return { saved: true, queue };
}

function readWeightedRunCount(modeSel, fixed, min, max) {
    if (modeSel.value === 'fixed') {
        return { mode: 'fixed', fixed: numOr(fixed.value, 1) };
    }
    return { mode: 'range', min: numOr(min.value, 1), max: numOr(max.value, 3) };
}

function numOr(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

function slotRow(slot, index, mode, onRemove, onUp, onDown) {
    const row = document.createElement('div');
    row.className = 'roulette-slot-row';
    const profiles = listProfileNames();
    const profileOptions = ['<option value="">(select profile)</option>']
        .concat(profiles.map(p => `<option value="${escapeHtml(p)}"${p === slot.profileName ? ' selected' : ''}>${escapeHtml(p)}</option>`))
        .join('');

    row.innerHTML = `
        <div class="roulette-slot-num">${index + 1}.</div>
        <select class="text_pole roulette-slot-profile" data-slot-field="profile">${profileOptions}</select>
        ${mode === 'sequential'
            ? `<select class="text_pole roulette-slot-narrow" data-slot-field="countMode">
                   <option value="fixed"${slot.countMode === 'fixed' ? ' selected' : ''}>Fixed</option>
                   <option value="range"${slot.countMode === 'range' ? ' selected' : ''}>Range</option>
               </select>
               <input type="number" class="text_pole roulette-slot-narrow" data-slot-field="fixedCount" min="1" value="${slot.fixedCount ?? 3}" title="Fixed response count" />
               <span class="roulette-range-fields ${slot.countMode === 'range' ? '' : 'hidden'}">
                   <input type="number" class="text_pole roulette-slot-narrow" data-slot-field="minCount" min="1" value="${slot.minCount ?? 2}" title="Min" />
                   <span>–</span>
                   <input type="number" class="text_pole roulette-slot-narrow" data-slot-field="maxCount" min="1" value="${slot.maxCount ?? 5}" title="Max" />
               </span>`
            : `<input type="number" class="text_pole roulette-slot-narrow" data-slot-field="weight" min="0" step="0.1" value="${slot.weight ?? 1}" title="Weight" />`
        }
        <div class="roulette-slot-actions">
            <i class="menu_button fa-solid fa-arrow-up" data-action="up" title="Move up"></i>
            <i class="menu_button fa-solid fa-arrow-down" data-action="down" title="Move down"></i>
            <i class="menu_button fa-solid fa-trash-can" data-action="remove" title="Remove slot"></i>
        </div>
    `;
    row.querySelector('[data-action="remove"]').addEventListener('click', onRemove);
    row.querySelector('[data-action="up"]').addEventListener('click', onUp);
    row.querySelector('[data-action="down"]').addEventListener('click', onDown);
    if (mode === 'sequential') {
        const countMode = row.querySelector('[data-slot-field="countMode"]');
        const rangeWrap = row.querySelector('.roulette-range-fields');
        const fixedInput = row.querySelector('[data-slot-field="fixedCount"]');
        const sync = () => {
            const isRange = countMode.value === 'range';
            rangeWrap.classList.toggle('hidden', !isRange);
            fixedInput.classList.toggle('hidden', isRange);
        };
        countMode.addEventListener('change', () => { slot.countMode = countMode.value; sync(); });
        sync();
    }
    return row;
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
        <h3 class="roulette-modal-title">Edit Queue</h3>
        <div class="roulette-form">
            <label class="roulette-field">
                <span>Queue name</span>
                <input type="text" class="text_pole" data-field="name" />
            </label>
            <label class="roulette-field">
                <span>Mode</span>
                <select class="text_pole" data-field="mode">
                    <option value="sequential">Sequential</option>
                    <option value="weighted-random">Weighted random</option>
                </select>
            </label>
            <div class="roulette-section-title">Slots</div>
            <div data-field="slots" class="roulette-slots"></div>
            <div class="roulette-row-actions">
                <button class="menu_button" data-action="add-slot" type="button">
                    <i class="fa-solid fa-plus"></i> Add slot
                </button>
            </div>
            <div data-field="weighted-footer" class="roulette-weighted-footer hidden">
                <div class="roulette-section-title">Weighted-random options</div>
                <label class="roulette-field-inline">
                    <input type="checkbox" data-field="no-repeat" />
                    <span>Don't repeat the same profile twice in a row</span>
                </label>
                <label class="roulette-field-inline">
                    <span>Run length</span>
                    <select class="text_pole" data-field="wr-count-mode">
                        <option value="fixed">Fixed</option>
                        <option value="range">Range</option>
                    </select>
                    <input type="number" class="text_pole roulette-slot-narrow" data-field="wr-fixed" min="1" value="1" />
                    <input type="number" class="text_pole roulette-slot-narrow" data-field="wr-min" min="1" value="1" />
                    <span>–</span>
                    <input type="number" class="text_pole roulette-slot-narrow" data-field="wr-max" min="1" value="3" />
                </label>
            </div>
        </div>
    `;
}
