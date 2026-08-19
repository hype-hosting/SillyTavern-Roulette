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
 * Where the pinned bar mounts, relative to SillyTavern's chat chrome.
 * The values are also the stored setting, so renaming one is a migration.
 */
export const BAR_POSITIONS = ['above-input', 'below-input', 'above-chat'];
export const DEFAULT_BAR_POSITION = 'above-input';

/**
 * Default global settings.
 */
function defaultSettings() {
    return {
        version: 2,
        queues: [],            // Queue[]
        // Queue the bar preselects when idle. Updated whenever a rotation
        // starts, so "start again" is always one click on the last thing
        // the user actually ran.
        lastQueueId: null,
        // Per-character queue bindings, keyed by the character's avatar
        // filename (ST's canonical stable character id — `this_chid` is a
        // volatile array index and must never be persisted).
        //   { [avatarFilename: string]: queueId }
        // Group chats are deliberately excluded; see src/characterBinding.js.
        characterQueues: {},
        ui: {
            animScale: 1,        // 0.25 - 2 (multiplier for every animation duration)
            accentColor: null,   // null = default steel; otherwise a CSS color string
            bar: {
                enabled: true,                     // is the pinned bar shown at all?
                position: DEFAULT_BAR_POSITION,    // one of BAR_POSITIONS
            },
        },
    };
}

/**
 * Get (and lazily initialise) the global settings block.
 *
 * Also carries pre-2.0 installs forward: the floating widget's `enabled`
 * flag becomes the bar's, and `defaultQueueId` becomes `lastQueueId`. Both
 * migrations are idempotent — the old keys are deleted once read, so this
 * runs at most once per install even though getSettings() is called
 * constantly.
 *
 * @returns {{version:number, queues:object[], lastQueueId:string|null, characterQueues:object, ui:object}}
 */
export function getSettings() {
    if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
        extension_settings[SETTINGS_KEY] = defaultSettings();
    }
    const s = extension_settings[SETTINGS_KEY];
    if (!Array.isArray(s.queues)) s.queues = [];
    if (typeof s.version !== 'number') s.version = 2;

    // v1.x stored this as `defaultQueueId` and never read it. v2 repurposes
    // it as the bar's preselected queue, so the old value is worth keeping.
    if (s.lastQueueId === undefined) s.lastQueueId = s.defaultQueueId ?? null;
    if ('defaultQueueId' in s) delete s.defaultQueueId;

    // Backfill the character-binding map — installs predating v1.3 lack it.
    if (!s.characterQueues || typeof s.characterQueues !== 'object' || Array.isArray(s.characterQueues)) {
        s.characterQueues = {};
    }
    if (!s.ui || typeof s.ui !== 'object') s.ui = {};
    if (typeof s.ui.animScale !== 'number') s.ui.animScale = 1;
    if (s.ui.accentColor === undefined) s.ui.accentColor = null;

    if (!s.ui.bar || typeof s.ui.bar !== 'object') {
        // v1.1-1.3 had a floating widget in this slot. Someone who had it
        // pinned wanted an always-on-screen status readout, which is what
        // the bar is — so inherit their choice rather than resetting it.
        s.ui.bar = {
            enabled: typeof s.ui.widget?.enabled === 'boolean' ? s.ui.widget.enabled : true,
            position: DEFAULT_BAR_POSITION,
        };
    }
    if ('widget' in s.ui) delete s.ui.widget;
    const bar = s.ui.bar;
    if (typeof bar.enabled !== 'boolean') bar.enabled = true;
    if (!BAR_POSITIONS.includes(bar.position)) bar.position = DEFAULT_BAR_POSITION;

    s.version = 2;
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
    if (settings.lastQueueId === queueId) {
        settings.lastQueueId = null;
    }
    // Drop any character bindings that pointed at this queue, otherwise the
    // map accumulates dangling ids that resolve to nothing on chat load.
    // Done inline rather than via characterBinding.js: that module imports
    // this one, and routing the prune back through it would form a cycle.
    for (const [avatar, boundId] of Object.entries(settings.characterQueues ?? {})) {
        if (boundId === queueId) delete settings.characterQueues[avatar];
    }
    persistSettings();
    return true;
}

/**
 * Remember which queue the user last ran, so the idle bar can offer it as a
 * one-click restart. Persists only when the value actually changes.
 */
export function setLastQueueId(queueId) {
    const settings = getSettings();
    if (settings.lastQueueId === queueId) return;
    settings.lastQueueId = queueId ?? null;
    persistSettings();
}

/**
 * The queue the idle bar should offer. Falls back to the first defined
 * queue when there's no history (or the remembered one has been deleted).
 *
 * @returns {object|null}
 */
export function preferredQueue() {
    const settings = getSettings();
    return findQueue(settings.lastQueueId) ?? settings.queues[0] ?? null;
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
    // Same selector pair as the token block in style.css: the popup-chrome
    // override rules read these variables from the .popup element itself,
    // which is an ANCESTOR of .roulette-extension — custom properties only
    // inherit downward, so the popup needs its own definition.
    const lines = ['.roulette-extension, .popup:has(.roulette-extension) {'];
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
            // Soft variant for subtler accents (borders, rules, idle chrome).
            const soft = mixWithBg(rgb, 0.6);
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
    // Anchored to the full string on purpose: the value is interpolated into
    // a <style> block, so a trailing "…); } evil {" must not round-trip.
    const rgbMatch = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i);
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
    // surface RGB is derived from --roulette-surface-2 (#1b1e26 ≈ 27, 30, 38).
    const bg = { r: 27, g: 30, b: 38 };
    return {
        r: Math.round(rgb.r * ratio + bg.r * (1 - ratio)),
        g: Math.round(rgb.g * ratio + bg.g * (1 - ratio)),
        b: Math.round(rgb.b * ratio + bg.b * (1 - ratio)),
    };
}
