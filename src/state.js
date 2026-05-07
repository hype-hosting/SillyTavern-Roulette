/* SillyTavern-Roulette — AGPL-3.0
 *
 * Persistence layer. Splits storage between:
 *   - extension_settings.roulette  (queue defs, UI prefs — global, reused across chats)
 *   - chat_metadata.roulette       (active rotation state — per-chat)
 *
 * All writes go through the debounced helpers (saveSettingsDebounced /
 * saveMetadataDebounced) — never synchronous on every message.
 */

import { saveSettingsDebounced, chat_metadata } from '../../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../../../scripts/extensions.js';
import { emptyState } from './rotation.js';

export const SETTINGS_KEY = 'roulette';
export const METADATA_KEY = 'roulette';

/**
 * Default global settings.
 */
function defaultSettings() {
    return {
        version: 1,
        queues: [],            // Queue[]
        defaultQueueId: null,  // optional: queue used as initial pick when starting a new chat
        ui: {
            animScale: 1,        // 0.25 - 2 (multiplier for every animation duration)
            accentColor: null,   // null = default brass; otherwise a CSS color string
            widget: {
                enabled: false,    // floating widget toggled on?
                collapsed: false,  // small dice-icon dot vs full panel
                x: null,           // viewport-pixel position; null = first-time default
                y: null,
                historyOpen: false, // is the history dropdown expanded?
            },
        },
    };
}

/**
 * Get (and lazily initialise) the global settings block.
 * @returns {{version:number, queues:object[], defaultQueueId:string|null, ui:object}}
 */
export function getSettings() {
    if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
        extension_settings[SETTINGS_KEY] = defaultSettings();
    }
    const s = extension_settings[SETTINGS_KEY];
    if (!Array.isArray(s.queues)) s.queues = [];
    if (typeof s.version !== 'number') s.version = 1;
    if (s.defaultQueueId === undefined) s.defaultQueueId = null;
    if (!s.ui || typeof s.ui !== 'object') s.ui = { animScale: 1, accentColor: null };
    if (typeof s.ui.animScale !== 'number') s.ui.animScale = 1;
    if (s.ui.accentColor === undefined) s.ui.accentColor = null;
    // Backfill widget block — old installs don't have it.
    if (!s.ui.widget || typeof s.ui.widget !== 'object') {
        s.ui.widget = { enabled: false, collapsed: false, x: null, y: null, historyOpen: false };
    }
    const w = s.ui.widget;
    if (typeof w.enabled !== 'boolean') w.enabled = false;
    if (typeof w.collapsed !== 'boolean') w.collapsed = false;
    if (w.x !== null && typeof w.x !== 'number') w.x = null;
    if (w.y !== null && typeof w.y !== 'number') w.y = null;
    if (typeof w.historyOpen !== 'boolean') w.historyOpen = false;
    return s;
}

/**
 * Persist global settings (debounced).
 */
export function persistSettings() {
    saveSettingsDebounced();
}

/**
 * Get a queue by id, or null.
 */
export function findQueue(queueId) {
    if (!queueId) return null;
    return getSettings().queues.find(q => q.id === queueId) ?? null;
}

/**
 * Replace a queue by id (or insert if not present). Persists.
 */
export function upsertQueue(queue) {
    if (!queue || !queue.id) throw new Error('upsertQueue: queue.id required');
    const settings = getSettings();
    const i = settings.queues.findIndex(q => q.id === queue.id);
    if (i >= 0) settings.queues[i] = queue;
    else settings.queues.push(queue);
    persistSettings();
}

/**
 * Delete a queue by id. Persists. Returns true if it existed.
 */
export function deleteQueue(queueId) {
    const settings = getSettings();
    const i = settings.queues.findIndex(q => q.id === queueId);
    if (i < 0) return false;
    settings.queues.splice(i, 1);
    if (settings.defaultQueueId === queueId) {
        settings.defaultQueueId = null;
    }
    persistSettings();
    return true;
}

/**
 * Get (and lazily initialise) the per-chat rotation state.
 *
 * IMPORTANT: this references the live `chat_metadata` object exported by
 * SillyTavern's script.js. The reference is rebound when the user changes
 * chats, so we re-read it on every call rather than caching.
 */
export function getChatState() {
    if (!chat_metadata[METADATA_KEY] || typeof chat_metadata[METADATA_KEY] !== 'object') {
        chat_metadata[METADATA_KEY] = emptyState();
    }
    const state = chat_metadata[METADATA_KEY];
    // Backfill any missing fields (forward-compat with old chats).
    const fresh = emptyState();
    for (const key of Object.keys(fresh)) {
        if (!(key in state)) state[key] = fresh[key];
    }
    if (!Array.isArray(state.history)) state.history = [];
    return state;
}

/**
 * Replace the per-chat rotation state. Persists.
 */
export function setChatState(next) {
    chat_metadata[METADATA_KEY] = next;
    saveMetadataDebounced();
}

/**
 * Mutate the per-chat state via a producer function. Persists once.
 *
 * @param {(state: object) => object|void} producer
 *   Either return a new state object, or mutate the passed-in state in place
 *   and return undefined.
 */
export function updateChatState(producer) {
    const current = getChatState();
    const next = producer(current);
    if (next && next !== current) {
        chat_metadata[METADATA_KEY] = next;
    }
    saveMetadataDebounced();
}

/**
 * Apply user UI preferences (animation scale, accent colour) by injecting
 * CSS variable overrides into a single <style> block in <head>. Re-running
 * is idempotent — the same node is re-used and its content replaced.
 *
 * Call this on init() and after the Settings tab mutates getSettings().ui.
 */
export function applyUiSettings() {
    const ui = getSettings().ui ?? {};
    let style = document.getElementById('roulette-ui-overrides');
    if (!style) {
        style = document.createElement('style');
        style.id = 'roulette-ui-overrides';
        document.head.appendChild(style);
    }
    const lines = ['.roulette-extension {'];
    if (Number.isFinite(ui.animScale) && ui.animScale > 0) {
        lines.push(`    --roulette-anim-scale: ${ui.animScale};`);
    }
    if (ui.accentColor) {
        const rgb = parseColor(ui.accentColor);
        if (rgb) {
            const tuple = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
            lines.push(`    --roulette-accent: ${ui.accentColor};`);
            lines.push(`    --roulette-accent-rgb: ${tuple};`);
            // Glow variants now reference the tuple, so glow tracks accent
            // automatically — no separate rgba() recomputation per opacity.
            lines.push(`    --roulette-glow: rgba(var(--roulette-accent-rgb), 0.45);`);
            lines.push(`    --roulette-glow-strong: rgba(var(--roulette-accent-rgb), 0.75);`);
            // Soft variant for subtler accents (chamber border on idle, hub).
            const soft = mixWithBg(rgb, 0.65);
            lines.push(`    --roulette-accent-soft: rgb(${soft.r}, ${soft.g}, ${soft.b});`);
        }
    }
    lines.push('}');
    style.textContent = lines.join('\n');
}

function parseColor(input) {
    const s = String(input).trim();
    const hexMatch = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
        };
    }
    const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
        return {
            r: Number(rgbMatch[1]),
            g: Number(rgbMatch[2]),
            b: Number(rgbMatch[3]),
        };
    }
    return null;
}

function mixWithBg(rgb, ratio) {
    // Mix the accent toward the dark surface for the "soft" variant. The
    // surface RGB is derived from --roulette-surface-2 (#221d18 ≈ 34, 29, 24).
    const bg = { r: 34, g: 29, b: 24 };
    return {
        r: Math.round(rgb.r * ratio + bg.r * (1 - ratio)),
        g: Math.round(rgb.g * ratio + bg.g * (1 - ratio)),
        b: Math.round(rgb.b * ratio + bg.b * (1 - ratio)),
    };
}
