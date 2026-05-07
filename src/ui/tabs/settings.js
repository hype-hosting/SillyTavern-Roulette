/* SillyTavern-Roulette — AGPL-3.0
 *
 * Settings tab. Persists into extension_settings.roulette.ui via state.js.
 * applyUiSettings() injects a global <style> override so changes take
 * effect immediately without re-rendering the cylinder.
 *
 * Settings shipped:
 *   - Animation scale: 0.25× to 2× multiplier on every keyframe / transition
 *   - Accent colour: defaults to brass; user can override with any CSS colour
 */

import { getSettings, persistSettings, applyUiSettings } from '../../state.js';
import { profileColorPalette } from '../profileColors.js';
import { setWidgetEnabled, resetWidgetPosition } from '../widget.js';

const DEFAULT_ACCENT = '#c7a461';
const PRESETS = [
    { name: 'Brass',     value: '#c7a461' },
    { name: 'Copper',    value: '#d99c66' },
    { name: 'Emerald',   value: '#6fbf73' },
    { name: 'Crimson',   value: '#d96666' },
    { name: 'Amethyst',  value: '#b87dd9' },
    { name: 'Steel',     value: '#9aa6b2' },
];

export function mountSettingsTab(container) {
    container.innerHTML = `
        <div class="roulette-settings-layout">

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
                <p class="roulette-help">
                    Multiplies every animation duration. Drop to 0.5× for slow-cinematic spins
                    or 2× for instant-on. Drag to feel it live.
                </p>
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
                    Recolours the cylinder's metal — chamber borders, halos, glow, and accent
                    text. Pick a preset or use the colour picker.
                </p>
            </div>

            <div class="roulette-section">
                <div class="roulette-section-title">Profile palette</div>
                <p class="roulette-help">
                    Each connection profile gets a stable colour from this palette, assigned by
                    a hash of its name. Same profile, same colour, every chat.
                </p>
                <div class="roulette-palette-row" data-field="palette"></div>
            </div>

            <div class="roulette-section">
                <div class="roulette-section-title">Floating widget</div>
                <p class="roulette-help">
                    A draggable on-screen panel that mirrors the cylinder during chat. Click the
                    cylinder area to open this modal at the Chamber tab; click the chevron to
                    expand recent picks. Desktop only.
                </p>
                <div class="roulette-row-actions">
                    <button type="button" class="roulette-action" data-act="toggle-widget">
                        <i class="fa-solid fa-thumbtack"></i><span data-field="widget-toggle-label">Pin widget</span>
                    </button>
                    <button type="button" class="roulette-action" data-act="reset-widget-pos">
                        <i class="fa-solid fa-arrows-to-dot"></i><span>Reset position</span>
                    </button>
                </div>
            </div>

        </div>
    `;

    const ui = getSettings().ui;
    const animSlider = container.querySelector('[data-field="anim-scale"]');
    const animValue = container.querySelector('[data-field="anim-value"]');
    const colorInput = container.querySelector('[data-field="accent-color"]');
    const presetsRow = container.querySelector('[data-field="accent-presets"]');
    const paletteRow = container.querySelector('[data-field="palette"]');

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

    const widgetToggleBtn = container.querySelector('[data-act="toggle-widget"]');
    const widgetToggleLabel = container.querySelector('[data-field="widget-toggle-label"]');
    function syncWidgetLabel() {
        widgetToggleLabel.textContent = ui.widget?.enabled ? 'Unpin widget' : 'Pin widget';
        widgetToggleBtn.classList.toggle('roulette-action-go', !!ui.widget?.enabled);
    }
    syncWidgetLabel();
    widgetToggleBtn.addEventListener('click', () => {
        setWidgetEnabled(!ui.widget?.enabled);
        syncWidgetLabel();
    });
    container.querySelector('[data-act="reset-widget-pos"]').addEventListener('click', () => {
        resetWidgetPosition();
    });

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
