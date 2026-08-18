/* SillyTavern-Roulette — AGPL-3.0
 *
 * Drawer block for the Extensions panel. v2.0 trimmed it to the two things
 * that belong at this altitude:
 *
 *   - "Enable Roulette" / "Disable Roulette" — shows or hides the pinned
 *     bar. A pure chrome toggle: it never stops a running rotation and
 *     never blocks character auto-start bindings.
 *   - "Settings" — opens the full modal, where rotation control, queue
 *     management, and preferences all live.
 *
 * Everything the drawer used to duplicate (status line, queue picker,
 * Start / Stop / Skip / Resume) now has exactly one home: the bar for
 * quick actions, the modal for the rest.
 */

import { openRouletteModal } from './modal.js';
import { setBarEnabled, isBarEnabled } from './bar.js';
import { onRotationStateChanged } from '../events.js';

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

    rootEl.querySelector('[data-action="toggle-bar"]').addEventListener('click', () => {
        setBarEnabled(!isBarEnabled());
        render();
    });
    rootEl.querySelector('[data-action="open-modal"]').addEventListener('click', () => {
        openRouletteModal();
    });

    onRotationStateChanged(render);
    mounted = true;
    render();
}

function render() {
    if (!rootEl) return;
    const enabled = isBarEnabled();
    const btn = rootEl.querySelector('[data-action="toggle-bar"]');
    btn.querySelector('[data-field="toggle-label"]').textContent =
        enabled ? 'Disable Roulette' : 'Enable Roulette';
    btn.querySelector('i').className = `fa-solid ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`;
    btn.title = enabled
        ? 'Hide the Roulette bar (a running rotation keeps going)'
        : 'Show the Roulette bar in the chat area';
}

function template() {
    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Roulette</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="roulette-row-actions">
                    <button class="menu_button" data-action="toggle-bar" type="button">
                        <i class="fa-solid fa-toggle-on"></i> <span data-field="toggle-label">Disable Roulette</span>
                    </button>
                    <button class="menu_button" data-action="open-modal" type="button">
                        <i class="fa-solid fa-gear"></i> Settings
                    </button>
                </div>
            </div>
        </div>
    `;
}
