/* SillyTavern-Roulette — AGPL-3.0
 *
 * Queue editor. Shared form-building lives in buildEditorElement(); two
 * presentation paths consume it:
 *
 *   - openQueueEditor(initialQueue) — ST Popup-class popup. Used by the
 *     legacy drawer settings panel until step 10 trims it. Will also be
 *     useful as a small confirm-style editor in future contexts.
 *   - renderEditorInto(container, initialQueue, callbacks) — embeds the
 *     form into a container. Used by the modal's Queues tab (step 7) so
 *     editing replaces the right pane instead of stacking a popup.
 *
 * Shared:
 *   - drag-and-drop slot reorder
 *   - live-bound field changes write through to the queue object on input
 *   - simulate-20-picks button (preview without saving)
 *   - validateQueue + upsertQueue on Save
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../scripts/popup.js';
import { listProfileNames } from '../profileSwitcher.js';
import { upsertQueue } from '../state.js';
import { validateQueue, pickInitialSlot, advanceSlot } from '../rotation.js';
import {
    resolveApiIdForProfile,
    fieldsForApi,
    apiSupportsParam,
    TUNING_PARAM_IDS,
    TUNING_PARAM_LABELS,
    API_PARAM_MAP,
    cleanupManagedPresetForSlot,
} from '../sampling.js';

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
 * Build the editor form element and wire up all live-binding behaviour.
 * Returns the element plus helpers; the CALLER decides how to present it
 * (popup, embedded pane, etc.) and provides the Save action.
 *
 * @param {object|null} initialQueue
 * @returns {{element: HTMLElement, queue: object, finalize: () => string[]}}
 *   `finalize` reads the name input + validates and returns errors (empty
 *   if all good). It also normalises the queue.name in place.
 */
export function buildEditorElement(initialQueue = null) {
    const queue = initialQueue
        ? structuredClone(initialQueue)
        : defaultQueue();

    const root = document.createElement('div');
    root.className = 'roulette-extension roulette-queue-editor';
    root.innerHTML = template();

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
    const simulateBtn = root.querySelector('[data-action="simulate"]');
    const simulateOut = root.querySelector('[data-field="simulate-output"]');

    nameInput.value = queue.name ?? '';
    modeSelect.value = queue.mode ?? 'sequential';
    noRepeatToggle.checked = !!queue.noRepeatInRow;
    const wrc = queue.weightedRunCount ?? { mode: 'fixed', fixed: 1 };
    wrCountModeSel.value = wrc.mode ?? 'fixed';
    wrFixed.value = wrc.fixed ?? 1;
    wrMin.value = wrc.min ?? 1;
    wrMax.value = wrc.max ?? 3;
    syncWrCountModeUI();

    nameInput.addEventListener('input', () => { queue.name = nameInput.value; });
    noRepeatToggle.addEventListener('change', () => { queue.noRepeatInRow = noRepeatToggle.checked; });
    wrCountModeSel.addEventListener('change', () => {
        queue.weightedRunCount = readWeightedRunCount(wrCountModeSel, wrFixed, wrMin, wrMax);
        syncWrCountModeUI();
    });
    [wrFixed, wrMin, wrMax].forEach(el => el.addEventListener('input', () => {
        queue.weightedRunCount = readWeightedRunCount(wrCountModeSel, wrFixed, wrMin, wrMax);
    }));

    function syncWrCountModeUI() {
        const isRange = wrCountModeSel.value === 'range';
        wrFixed.classList.toggle('hidden', isRange);
        wrMin.classList.toggle('hidden', !isRange);
        wrMax.classList.toggle('hidden', !isRange);
    }

    function renderSlots() {
        slotsContainer.innerHTML = '';
        queue.slots.forEach((slot, i) => {
            slotsContainer.appendChild(slotRow(slot, i, queue.mode, queue, renderSlots));
        });
        setupDragAndDrop();
    }

    function setupDragAndDrop() {
        const rows = Array.from(slotsContainer.querySelectorAll('.roulette-slot-row'));
        rows.forEach((row, i) => {
            row.addEventListener('dragstart', (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                row.classList.add('roulette-dragging');
            });
            row.addEventListener('dragend', () => {
                row.classList.remove('roulette-dragging');
                slotsContainer.querySelectorAll('.roulette-drag-over')
                    .forEach(r => r.classList.remove('roulette-drag-over'));
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            row.addEventListener('dragenter', (e) => {
                if (!row.classList.contains('roulette-dragging')) {
                    row.classList.add('roulette-drag-over');
                }
                e.preventDefault();
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('roulette-drag-over');
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData('text/plain'));
                const to = i;
                if (Number.isNaN(from) || from === to) return;
                const [moved] = queue.slots.splice(from, 1);
                queue.slots.splice(to, 0, moved);
                renderSlots();
            });
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

    simulateBtn.addEventListener('click', () => {
        renderSimulation(queue, simulateOut);
    });

    syncModeUI();

    function finalize() {
        queue.name = (nameInput.value || '').trim() || 'Queue';
        return validateQueue(queue);
    }

    return { element: root, queue, finalize };
}

/**
 * Open the editor as a popup (legacy path). Saves on AFFIRMATIVE result.
 *
 * @param {object|null} initialQueue
 * @returns {Promise<{saved: boolean, queue: object|null}>}
 */
export async function openQueueEditor(initialQueue = null) {
    const { element, queue, finalize } = buildEditorElement(initialQueue);

    const popup = new Popup(element, POPUP_TYPE.CONFIRM, '', {
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

    const errors = finalize();
    if (errors.length) {
        if (typeof toastr !== 'undefined') {
            toastr.error('Cannot save queue:\n' + errors.join('\n'));
        }
        return { saved: false, queue: null };
    }

    upsertQueue(queue);
    return { saved: true, queue };
}

/**
 * Render the editor inline into a container, with explicit Save/Cancel
 * buttons added above the form. onSave fires with the saved queue;
 * onCancel fires with no args. Returns a dispose() callback that strips
 * the editor.
 *
 * @param {HTMLElement} container
 * @param {object|null} initialQueue
 * @param {object} callbacks
 * @param {(queue: object) => void} callbacks.onSave
 * @param {() => void} callbacks.onCancel
 * @returns {() => void} dispose
 */
export function renderEditorInto(container, initialQueue, { onSave, onCancel } = {}) {
    const { element, queue, finalize } = buildEditorElement(initialQueue);
    container.innerHTML = '';

    // Header bar with Cancel/Save lives ABOVE the form so it's always
    // visible without scrolling.
    const header = document.createElement('div');
    header.className = 'roulette-editor-header';
    header.innerHTML = `
        <button type="button" class="roulette-action" data-act="cancel">
            <i class="fa-solid fa-arrow-left"></i><span>Back</span>
        </button>
        <div class="roulette-editor-title">${initialQueue ? 'Edit queue' : 'New queue'}</div>
        <button type="button" class="roulette-action roulette-action-go" data-act="save">
            <i class="fa-solid fa-check"></i><span>Save</span>
        </button>
    `;
    container.appendChild(header);
    container.appendChild(element);

    const cancelBtn = header.querySelector('[data-act="cancel"]');
    const saveBtn = header.querySelector('[data-act="save"]');

    cancelBtn.addEventListener('click', () => {
        onCancel?.();
    });
    saveBtn.addEventListener('click', () => {
        const errors = finalize();
        if (errors.length) {
            if (typeof toastr !== 'undefined') {
                toastr.error('Cannot save queue:\n' + errors.join('\n'));
            }
            return;
        }
        upsertQueue(queue);
        onSave?.(queue);
    });

    return () => {
        // No persistent listeners outside the element; container will be
        // emptied by the caller, which removes the form. Provided for
        // symmetry / future use.
    };
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

function slotRow(slot, index, mode, queue, rerender) {
    const row = document.createElement('div');
    row.className = 'roulette-slot-row';
    row.draggable = true;
    const profiles = listProfileNames();
    const profileOptions = ['<option value="">(select profile)</option>']
        .concat(profiles.map(p => `<option value="${escapeHtml(p)}"${p === slot.profileName ? ' selected' : ''}>${escapeHtml(p)}</option>`))
        .join('');

    const tuningEnabled = !!slot.tuning?.enabled;
    const tuningOpenInitial = !!slot.tuning?.enabled || (slot.tuning && Object.keys(slot.tuning.params || {}).length > 0);

    row.innerHTML = `
        <i class="fa-solid fa-grip-vertical roulette-slot-grip" title="Drag to reorder"></i>
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
            <i class="menu_button fa-solid fa-sliders ${tuningEnabled ? 'roulette-slot-tune-active' : ''}" data-action="toggle-tuning" title="Tune sampler params for this slot"></i>
            <i class="menu_button fa-solid fa-trash-can" data-action="remove" title="Remove slot"></i>
        </div>
        <div class="roulette-slot-tuning ${tuningOpenInitial ? '' : 'hidden'}" data-field="tuning"></div>
    `;

    row.querySelectorAll('select, input').forEach(el => {
        el.addEventListener('mousedown', e => e.stopPropagation());
        el.draggable = false;
    });

    row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
        // Clean up the managed sampler preset before forgetting the slot.
        await cleanupManagedPresetForSlot(slot);
        queue.slots.splice(index, 1);
        if (queue.slots.length === 0) queue.slots.push(defaultSlot());
        rerender();
    });

    const tuningPanel = row.querySelector('[data-field="tuning"]');
    const tuneBtn = row.querySelector('[data-action="toggle-tuning"]');
    tuneBtn.addEventListener('click', () => {
        tuningPanel.classList.toggle('hidden');
    });
    renderTuningPanel(tuningPanel, slot);

    const profileSel = row.querySelector('[data-slot-field="profile"]');
    profileSel.addEventListener('change', () => {
        slot.profileName = profileSel.value.trim();
        // The new profile may use a different API; re-render the panel
        // so the param subset matches.
        renderTuningPanel(tuningPanel, slot);
    });

    if (mode === 'sequential') {
        const countModeSel = row.querySelector('[data-slot-field="countMode"]');
        const rangeWrap = row.querySelector('.roulette-range-fields');
        const fixedInput = row.querySelector('[data-slot-field="fixedCount"]');
        const minInput = row.querySelector('[data-slot-field="minCount"]');
        const maxInput = row.querySelector('[data-slot-field="maxCount"]');
        const sync = () => {
            const isRange = countModeSel.value === 'range';
            rangeWrap.classList.toggle('hidden', !isRange);
            fixedInput.classList.toggle('hidden', isRange);
        };
        countModeSel.addEventListener('change', () => {
            slot.countMode = countModeSel.value;
            sync();
        });
        fixedInput.addEventListener('input', () => { slot.fixedCount = numOr(fixedInput.value, 1); });
        minInput.addEventListener('input', () => { slot.minCount = numOr(minInput.value, 1); });
        maxInput.addEventListener('input', () => { slot.maxCount = numOr(maxInput.value, 3); });
        sync();
    } else {
        const weightInput = row.querySelector('[data-slot-field="weight"]');
        weightInput.addEventListener('input', () => { slot.weight = numOr(weightInput.value, 1); });
    }

    return row;
}

/**
 * Build the inline sampler-tuning panel for a slot. Shows only params
 * relevant to the slot's profile's API. Edits write through to
 * slot.tuning.params; the enabled toggle gates whether the params are
 * actually applied on rotation.
 */
function renderTuningPanel(panelEl, slot) {
    if (!panelEl) return;
    const apiId = resolveApiIdForProfile(slot.profileName);

    if (!apiId) {
        panelEl.innerHTML = `
            <div class="roulette-tuning-empty">
                Pick a profile first — sampler tuning is API-aware.
            </div>
        `;
        return;
    }

    const map = API_PARAM_MAP[apiId];
    const fields = fieldsForApi(apiId);
    const supportedIds = TUNING_PARAM_IDS.filter(id => apiSupportsParam(apiId, id));

    if (!slot.tuning) slot.tuning = { enabled: false, presetName: null, params: {} };
    if (!slot.tuning.params) slot.tuning.params = {};

    panelEl.innerHTML = `
        <div class="roulette-tuning-header">
            <span class="roulette-section-title">Sampler tuning</span>
            <span class="roulette-tuning-api">API: <code>${escapeHtml(map.label || apiId)}</code></span>
            <label class="roulette-tuning-toggle">
                <input type="checkbox" data-tuning-field="enabled" ${slot.tuning.enabled ? 'checked' : ''} />
                <span>Enable on rotation</span>
            </label>
        </div>
        <div class="roulette-tuning-grid">
            ${supportedIds.map(id => {
                const spec = fields[id];
                const current = slot.tuning.params[id];
                const value = current != null ? current : (spec.min + spec.max) / 2;
                return `
                    <label class="roulette-tuning-param" data-tuning-field-row="${id}">
                        <span class="roulette-tuning-param-label">${escapeHtml(TUNING_PARAM_LABELS[id])}</span>
                        <input type="range"
                               class="roulette-range roulette-tuning-slider"
                               data-tuning-field="${id}"
                               min="${spec.min}" max="${spec.max}" step="${spec.step}"
                               value="${value}" />
                        <input type="number"
                               class="text_pole roulette-tuning-number"
                               data-tuning-field-num="${id}"
                               min="${spec.min}" max="${spec.max}" step="${spec.step}"
                               value="${current != null ? current : ''}"
                               placeholder="default" />
                        <button type="button" class="roulette-tuning-clear" data-tuning-clear="${id}" title="Use profile default">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                    </label>
                `;
            }).join('')}
        </div>
    `;

    const enabledInput = panelEl.querySelector('[data-tuning-field="enabled"]');
    enabledInput.addEventListener('change', () => {
        slot.tuning.enabled = enabledInput.checked;
    });

    // Wire each row: range and number stay in sync, clear button blanks
    // the param so the profile's preset default is used at rotation time.
    panelEl.querySelectorAll('.roulette-tuning-param').forEach(rowEl => {
        const id = rowEl.dataset.tuningFieldRow;
        const slider = rowEl.querySelector('[data-tuning-field]');
        const number = rowEl.querySelector('[data-tuning-field-num]');
        const clearBtn = rowEl.querySelector('[data-tuning-clear]');

        const writeValue = (v) => {
            if (v == null || v === '' || !Number.isFinite(Number(v))) {
                delete slot.tuning.params[id];
                number.value = '';
            } else {
                slot.tuning.params[id] = Number(v);
                number.value = String(v);
            }
        };

        slider.addEventListener('input', () => {
            slider.parentElement.classList.add('roulette-tuning-touched');
            writeValue(slider.value);
        });
        number.addEventListener('input', () => {
            const v = number.value;
            if (v === '') {
                delete slot.tuning.params[id];
            } else if (Number.isFinite(Number(v))) {
                slot.tuning.params[id] = Number(v);
                slider.value = v;
            }
        });
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete slot.tuning.params[id];
            number.value = '';
            // Snap slider to the midpoint as a visual reset; not committed
            // because we deleted the param above.
            const spec = fields[id];
            slider.value = (spec.min + spec.max) / 2;
        });
    });
}

function renderSimulation(queue, outEl) {
    const errors = validateQueue(queue);
    if (errors.length) {
        outEl.classList.remove('hidden');
        outEl.innerHTML = `<div class="roulette-simulate-error">Cannot simulate — fix these first:<ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`;
        return;
    }
    const PICKS = 20;
    let pick = pickInitialSlot(queue);
    if (!pick) {
        outEl.classList.remove('hidden');
        outEl.textContent = 'Could not pick an initial slot.';
        return;
    }

    // Group output by roll boundary (each new advanceSlot is a new run),
    // not by profile name. Otherwise weighted-random with no-repeat OFF
    // can show "GLM-4.7×5" when in reality it was two independent rolls
    // (e.g. 3 + 2) that happened to land on the same profile — making
    // the range cap look like it was violated when it wasn't.
    const runs = [];
    let idx = pick.slotIndex;
    let remaining = pick.responses;
    let total = 0;
    let current = { name: queue.slots[idx].profileName || '?', count: 0 };
    runs.push(current);

    while (total < PICKS) {
        current.count++;
        total++;
        remaining--;
        if (remaining <= 0 && total < PICKS) {
            const next = advanceSlot(queue, idx);
            if (!next) break;
            idx = next.slotIndex;
            remaining = next.responses;
            current = { name: queue.slots[idx].profileName || '?', count: 0 };
            runs.push(current);
        }
    }
    const summary = runs
        .filter(r => r.count > 0)
        .map(r => r.count > 1 ? `${escapeHtml(r.name)}×${r.count}` : escapeHtml(r.name))
        .join(', ');
    outEl.classList.remove('hidden');
    outEl.innerHTML = `<div class="roulette-simulate-result"><b>Sample of 20 picks:</b><br>${summary}</div>`;
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
                <button class="menu_button" data-action="simulate" type="button" title="Run 20 picks against this queue without saving">
                    <i class="fa-solid fa-flask"></i> Simulate 20 picks
                </button>
            </div>
            <div data-field="simulate-output" class="roulette-simulate-output hidden"></div>
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
