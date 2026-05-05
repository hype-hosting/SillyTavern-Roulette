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
    };
}

/**
 * Get (and lazily initialise) the global settings block.
 * @returns {{version:number, queues:object[], defaultQueueId:string|null}}
 */
export function getSettings() {
    if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
        extension_settings[SETTINGS_KEY] = defaultSettings();
    }
    const s = extension_settings[SETTINGS_KEY];
    if (!Array.isArray(s.queues)) s.queues = [];
    if (typeof s.version !== 'number') s.version = 1;
    if (s.defaultQueueId === undefined) s.defaultQueueId = null;
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
