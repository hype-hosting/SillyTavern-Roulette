/* SillyTavern-Roulette — AGPL-3.0
 *
 * Settings tab. Persists into extension_settings.roulette.ui via state.js.
 * applyUiSettings() injects a global <style> override so changes take
 * effect immediately without re-rendering anything.
 *
 * Sections:
 *   - Pinned bar: show/hide + where it mounts (three-way segmented control)
 *   - Animation speed: 0.25× to 2× multiplier on every transition
 *   - Accent colour: chrome accent (active tab, buttons, section rules)
 *   - Profile palette: read-only swatch row of the hash-assigned dot colours
 */

import { getSettings, persistSettings, applyUiSettings, BAR_POSITIONS } from '../../state.js';
import { profileColorPalette } from '../profileColors.js';
import { setBarEnabled, setBarPosition, isBarEnabled } from '../bar.js';

const DEFAULT_ACCENT = '#8fa4c4';
const PRESETS = [
    { name: 'Steel',    value: '#8fa4c4' },
    { name: 'Blue',     value: '#6ea8fe' },
    { name: 'Green',    value: '#5ed3a0' },
    { name: 'Violet',   value: '#c79bff' },
    { name: 'Amber',    value: '#ffc861' },
    { name: 'Rose',     value: '#ff8fc7' },
];

const POSITION_LABELS = {
    'above-input': 'Above message bar',
    'below-input': 'Below message bar',
    'above-chat':  'Above chat',
};

export function mountSettingsTab(container) {
    container.innerHTML = `
        <div class="roulette-settings-layout">

            <div class="roulette-section">
                <div class="roulette-section-title-row">
                    <div class="roulette-section-title">Pinned bar</div>
                    <label class="roulette-toggle">
                        <input type="checkbox" data-field="bar-enabled" />
                        <span data-field="bar-enabled-label">Shown</span>
                    </label>
                </div>
                <div class="roulette-segmented" data-field="bar-position" role="radiogroup" aria-label="Bar position">
                    ${BAR_POSITIONS.map(pos => `
                        <button type="button" class="roulette-segment" data-position="${pos}" role="radio">
                            ${POSITION_LABELS[pos]}
                        </button>
                    `).join('')}
                </div>
                <p class="roulette-help">
                    The bar shows the rotation dots, current profile, and Skip / Stop during
                    chat. Hiding it never stops a running rotation — it only removes the chrome.
                </p>
            </div>

            <div class="roulette-section">
                <div class="roulette-section-title-row">
                    <div class="roulette-section-title">Animation speed</div>
                    <div class="roulette-section-value" data-field="anim-value">1.0×</div>
                </div>
                <input type="range" min="0.25" max="2" step="0.05" value="1"
                       class="roulette-range" data-field="anim-scale" />
                <div class="roulette-range-labels">
                    <span>Slow</span>
                    <span>Default</span>
                    <span>Fast</span>
                </div>
            </div>

            <div class="roulette-section">
                <div class="roulette-section-title">Accent colour</div>
                <div class="roulette-accent-row" data-field="accent-presets"></div>
                <div class="roulette-accent-custom">
                    <label class="roulette-accent-custom-label">
                        <span>Custom:</span>
                        <input type="color" class="roulette-color-input" data-field="accent-color" />
                    </label>
                    <button type="button" class="roulette-action" data-act="reset-accent">
                        <i class="fa-solid fa-rotate-left"></i><span>Reset</span>
                    </button>
                </div>
                <p class="roulette-help">
                    Tints the chrome — active tab, buttons, section rules. Profile dots keep
                    their own colours regardless.
                </p>
            </div>

            <div class="roulette-section">
                <div class="roulette-section-title">Profile palette</div>
                <div class="roulette-palette-row" data-field="palette"></div>
                <p class="roulette-help">
                    Each connection profile gets a stable colour from this palette, assigned
                    by a hash of its name. Same profile, same colour, every chat.
                </p>
            </div>

        </div>
    `;

    const ui = getSettings().ui;
    const animSlider = container.querySelector('[data-field="anim-scale"]');
    const animValue = container.querySelector('[data-field="anim-value"]');
    const colorInput = container.querySelector('[data-field="accent-color"]');
    const presetsRow = container.querySelector('[data-field="accent-presets"]');
    const paletteRow = container.querySelector('[data-field="palette"]');
    const barEnabled = container.querySelector('[data-field="bar-enabled"]');
    const positionGroup = container.querySelector('[data-field="bar-position"]');

    barEnabled.addEventListener('change', () => {
        setBarEnabled(barEnabled.checked);
        syncBarControls(container);
    });
    positionGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-position]');
        if (!btn) return;
        setBarPosition(btn.dataset.position);
        syncBarControls(container);
    });

    animSlider.value = String(ui.animScale ?? 1);
    animValue.textContent = `${Number(animSlider.value).toFixed(2)}×`;
    animSlider.addEventListener('input', () => {
        const scale = Number(animSlider.value) || 1;
        animValue.textContent = `${scale.toFixed(2)}×`;
        ui.animScale = scale;
        persistSettings();
        applyUiSettings();
    });

    colorInput.value = ui.accentColor ?? DEFAULT_ACCENT;
    colorInput.addEventListener('input', () => {
        ui.accentColor = colorInput.value;
        persistSettings();
        applyUiSettings();
        renderPresets(ui, presetsRow, colorInput);
    });

    container.querySelector('[data-act="reset-accent"]').addEventListener('click', () => {
        ui.accentColor = null;
        colorInput.value = DEFAULT_ACCENT;
        persistSettings();
        applyUiSettings();
        renderPresets(ui, presetsRow, colorInput);
    });

    syncBarControls(container);
    renderPresets(ui, presetsRow, colorInput);
    renderPalette(paletteRow);
}

export function refreshSettingsTab(container) {
    if (!container) return;
    const ui = getSettings().ui;
    const animSlider = container.querySelector('[data-field="anim-scale"]');
    const animValue = container.querySelector('[data-field="anim-value"]');
    if (animSlider) {
        animSlider.value = String(ui.animScale ?? 1);
        animValue.textContent = `${Number(animSlider.value).toFixed(2)}×`;
    }
    const colorInput = container.querySelector('[data-field="accent-color"]');
    if (colorInput) colorInput.value = ui.accentColor ?? DEFAULT_ACCENT;
    const presetsRow = container.querySelector('[data-field="accent-presets"]');
    if (presetsRow) renderPresets(ui, presetsRow, colorInput);
    syncBarControls(container);
}

function syncBarControls(container) {
    const settings = getSettings();
    const enabled = isBarEnabled();
    const box = container.querySelector('[data-field="bar-enabled"]');
    const label = container.querySelector('[data-field="bar-enabled-label"]');
    const group = container.querySelector('[data-field="bar-position"]');
    if (!box || !group) return;
    box.checked = enabled;
    if (label) label.textContent = enabled ? 'Shown' : 'Hidden';
    group.classList.toggle('roulette-segmented-disabled', !enabled);
    group.querySelectorAll('[data-position]').forEach(btn => {
        const active = btn.dataset.position === settings.ui.bar.position;
        btn.classList.toggle('roulette-segment-active', active);
        btn.setAttribute('aria-checked', String(active));
        btn.disabled = !enabled;
    });
}

function renderPresets(ui, host, colorInput) {
    host.innerHTML = '';
    const current = (ui.accentColor ?? DEFAULT_ACCENT).toLowerCase();
    for (const preset of PRESETS) {
        const isActive = preset.value.toLowerCase() === current;
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = `roulette-swatch ${isActive ? 'roulette-swatch-active' : ''}`;
        swatch.style.backgroundColor = preset.value;
        swatch.title = preset.name;
        swatch.setAttribute('aria-label', `Accent: ${preset.name}`);
        swatch.addEventListener('click', () => {
            ui.accentColor = preset.value === DEFAULT_ACCENT ? null : preset.value;
            colorInput.value = preset.value;
            persistSettings();
            applyUiSettings();
            renderPresets(ui, host, colorInput);
        });
        host.appendChild(swatch);
    }
}

function renderPalette(host) {
    host.innerHTML = '';
    for (const c of profileColorPalette()) {
        const dot = document.createElement('span');
        dot.className = 'roulette-palette-dot';
        dot.style.backgroundColor = c;
        dot.title = c;
        host.appendChild(dot);
    }
}
