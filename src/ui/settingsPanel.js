/* SillyTavern-Roulette — AGPL-3.0
 *
 * Trimmed drawer block for the Extensions panel. Now strictly utility:
 *   - status line (compact)
 *   - quick actions: Start / Stop / Skip / Resume
 *   - queue picker dropdown for fast in-chat activation
 *   - "Open Roulette" button → opens the full modal
 *
 * Queue management, history, import/export, settings — all live in the
 * modal as of step 10. The drawer is just the chat-side panic button.
 */

import { getSettings, findQueue, getChatState } from '../state.js';
import { startRotation, stopRotation, resumeRotation, skipCurrentSlot, onRotationStateChanged } from '../events.js';
import { openRouletteModal } from './modal.js';
import { setWidgetEnabled } from './widget.js';

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

    rootEl.querySelector('[data-action="open-modal"]').addEventListener('click', () => {
        openRouletteModal();
    });
    rootEl.querySelector('[data-action="toggle-widget"]').addEventListener('click', () => {
        const ui = getSettings().ui;
        const next = !ui.widget?.enabled;
        setWidgetEnabled(next);
        render();
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

    // Queue picker.
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
        statusEl.textContent = `${name} · ${profile} · ${left} left${flag}`;
    }

    rootEl.querySelector('[data-action="stop"]').classList.toggle('hidden', !state.activeQueueId);
    rootEl.querySelector('[data-action="skip"]').classList.toggle('hidden', !state.activeQueueId);
    rootEl.querySelector('[data-action="resume"]').classList.toggle('hidden', !state.manuallyOverridden);

    // Widget toggle button label reflects current pinned state.
    const widgetEnabled = !!settings.ui?.widget?.enabled;
    const widgetLabel = rootEl.querySelector('[data-field="widget-label"]');
    if (widgetLabel) widgetLabel.textContent = widgetEnabled ? 'Unpin widget' : 'Pin widget';
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
                <div class="roulette-row-actions">
                    <button class="menu_button" data-action="open-modal" type="button">
                        <i class="fa-solid fa-circle-dot"></i> Open Roulette
                    </button>
                    <button class="menu_button" data-action="toggle-widget" type="button"
                            title="Pin a small floating widget to the screen during chat">
                        <i class="fa-solid fa-thumbtack"></i> <span data-field="widget-label">Pin widget</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}
