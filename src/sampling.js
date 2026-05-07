/* SillyTavern-Roulette — AGPL-3.0
 *
 * Inline sampler tuning (v1.2). Bridges Roulette's per-slot `tuning` block
 * to ST's preset system so a queue can rotate "DeepSeek at temp 0.5" and
 * "Opus at temp 0.9" without leaving the queue editor.
 *
 * How it works
 * ============
 *  - Each slot can OPTIONALLY carry a `tuning: { enabled, presetName, params }`
 *    block (six common sampler params: temperature, top_p, top_k,
 *    frequency_penalty, presence_penalty, repetition_penalty).
 *  - On every rotation switch, `applyTuningOnSwitch(slot, queue)` runs
 *    AFTER the standard /profile call. If the slot has tuning enabled,
 *    it ensures a "managed preset" exists for that slot (creating one if
 *    needed by snapshotting current settings + overlaying the six params),
 *    then `/preset <managedPresetName>` overlays it on the live API.
 *  - Managed presets are named "[Roulette] queueName · profileName
 *    (slotShortId)" so users can identify them in the API's preset list.
 *  - Cleanup: when a slot is deleted / tuning is disabled / a queue is
 *    removed, Roulette deletes the corresponding managed preset.
 *
 * APIs supported: openai (chat-completion), kobold, textgenerationwebui,
 * novel. Other APIs silently no-op (rotation still works, just without
 * sampler overrides).
 */

import { extension_settings } from '../../../../../scripts/extensions.js';
import { oai_settings } from '../../../../../scripts/openai.js';
import { kai_settings } from '../../../../../scripts/kai-settings.js';
import { nai_settings } from '../../../../../scripts/nai-settings.js';
import { textgenerationwebui_settings } from '../../../../../scripts/textgen-settings.js';
import { getPresetManager } from '../../../../../scripts/preset-manager.js';
import { executeSlashCommandsWithOptions } from '../../../../../scripts/slash-commands.js';
import { isInternalSwitch } from './profileSwitcher.js';

/**
 * Declarative mapping: conceptual sampler param → API-specific key on the
 * settings object. Absence means the API doesn't expose that param; the
 * UI hides it for slots whose profile uses that API.
 */
export const API_PARAM_MAP = {
    openai: {
        label: 'Chat completion',
        settingsObj: () => oai_settings,
        fields: {
            temperature:        { key: 'temp_openai',         min: 0,  max: 2,   step: 0.05 },
            top_p:              { key: 'top_p_openai',        min: 0,  max: 1,   step: 0.05 },
            top_k:              { key: 'top_k_openai',        min: 0,  max: 200, step: 1 },
            frequency_penalty:  { key: 'freq_pen_openai',     min: -2, max: 2,   step: 0.1 },
            presence_penalty:   { key: 'pres_pen_openai',     min: -2, max: 2,   step: 0.1 },
            // chat-completion APIs don't take repetition_penalty
        },
    },
    kobold: {
        label: 'KoboldAI',
        settingsObj: () => kai_settings,
        fields: {
            temperature:        { key: 'temp',    min: 0, max: 2,    step: 0.05 },
            top_p:              { key: 'top_p',   min: 0, max: 1,    step: 0.05 },
            top_k:              { key: 'top_k',   min: 0, max: 200,  step: 1 },
            repetition_penalty: { key: 'rep_pen', min: 1, max: 1.5,  step: 0.01 },
        },
    },
    textgenerationwebui: {
        label: 'Text generation',
        settingsObj: () => textgenerationwebui_settings,
        fields: {
            temperature:        { key: 'temp',         min: 0,  max: 5,   step: 0.05 },
            top_p:              { key: 'top_p',        min: 0,  max: 1,   step: 0.05 },
            top_k:              { key: 'top_k',        min: 0,  max: 200, step: 1 },
            frequency_penalty:  { key: 'freq_pen',     min: -2, max: 2,   step: 0.1 },
            presence_penalty:   { key: 'presence_pen', min: -2, max: 2,   step: 0.1 },
            repetition_penalty: { key: 'rep_pen',      min: 1,  max: 1.5, step: 0.01 },
        },
    },
    novel: {
        label: 'NovelAI',
        settingsObj: () => nai_settings,
        fields: {
            temperature:        { key: 'temperature',        min: 0, max: 2,   step: 0.05 },
            top_p:              { key: 'top_p',              min: 0, max: 1,   step: 0.05 },
            top_k:              { key: 'top_k',              min: 0, max: 200, step: 1 },
            repetition_penalty: { key: 'repetition_penalty', min: 1, max: 4,   step: 0.05 },
        },
    },
};

/** Conceptual param ids (the union across APIs). UI iterates this list and
 *  hides anything the slot's API doesn't support. */
export const TUNING_PARAM_IDS = [
    'temperature',
    'top_p',
    'top_k',
    'frequency_penalty',
    'presence_penalty',
    'repetition_penalty',
];

/** Human-readable labels for the UI. */
export const TUNING_PARAM_LABELS = {
    temperature:        'Temperature',
    top_p:              'Top-p',
    top_k:              'Top-k',
    frequency_penalty:  'Freq. penalty',
    presence_penalty:   'Presence penalty',
    repetition_penalty: 'Rep. penalty',
};

/**
 * Resolve the API id for a slot's profile. Returns null if the profile
 * isn't found or its API isn't one we have a map entry for.
 *
 * @param {string} profileName
 * @returns {string|null}
 */
export function resolveApiIdForProfile(profileName) {
    const profiles = extension_settings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return null;
    const profile = profiles.find(p => p.name === profileName);
    if (!profile) return null;
    const apiId = profile.api;
    if (!apiId) return null;
    return API_PARAM_MAP[apiId] ? apiId : null;
}

/**
 * Returns the field-spec map for a given API id, or null.
 */
export function fieldsForApi(apiId) {
    return API_PARAM_MAP[apiId]?.fields ?? null;
}

/**
 * True if this API supports a given conceptual param.
 */
export function apiSupportsParam(apiId, paramId) {
    const fields = fieldsForApi(apiId);
    return !!(fields && fields[paramId]);
}

/**
 * Build a fresh empty tuning block. Caller fills in params + flags.
 */
export function emptyTuning() {
    return {
        enabled: false,
        presetName: null,
        params: {},
    };
}

/**
 * Validate that a tuning block is structurally sound. Returns array of
 * error strings (empty if valid). Used by validateQueue.
 */
export function validateTuning(tuning) {
    if (tuning == null) return [];
    if (typeof tuning !== 'object') return ['tuning must be an object or absent'];
    const errs = [];
    if (typeof tuning.enabled !== 'boolean') errs.push('tuning.enabled must be a boolean');
    if (tuning.presetName != null && typeof tuning.presetName !== 'string') {
        errs.push('tuning.presetName must be a string or null');
    }
    if (tuning.params == null || typeof tuning.params !== 'object') {
        errs.push('tuning.params must be an object');
    } else {
        for (const id of TUNING_PARAM_IDS) {
            if (tuning.params[id] != null && !Number.isFinite(tuning.params[id])) {
                errs.push(`tuning.params.${id} must be a finite number`);
            }
        }
    }
    return errs;
}

/**
 * Stable-ish managed-preset name. Includes the queue name + profile name
 * for legibility, and a 6-char slice of the slot's UUID so reorders /
 * renames don't collide.
 */
export function managedPresetName(slot, queueName) {
    const shortId = String(slot.id ?? '').slice(0, 6) || 'slot';
    const profileName = slot.profileName || 'profile';
    const safeQueue = String(queueName ?? 'queue').slice(0, 30);
    return `[Roulette] ${safeQueue} · ${profileName} (${shortId})`;
}

/**
 * Given the active API id, snapshot its current settings. Returns a
 * deep-cloned plain object (so we don't mutate ST's state).
 */
function snapshotCurrentSettings(apiId) {
    const map = API_PARAM_MAP[apiId];
    if (!map) return null;
    const live = map.settingsObj();
    if (!live) return null;
    // structuredClone keeps numbers/strings/arrays/plain objects safely.
    try { return structuredClone(live); }
    catch { return JSON.parse(JSON.stringify(live)); }
}

/**
 * Overlay a slot's tuning params onto a settings snapshot. Mutates the
 * snapshot in place; returns it for convenience.
 */
function overlayParams(snapshot, params, apiId) {
    const fields = fieldsForApi(apiId);
    if (!fields || !params) return snapshot;
    for (const id of TUNING_PARAM_IDS) {
        if (params[id] == null) continue;
        const spec = fields[id];
        if (!spec) continue;
        snapshot[spec.key] = Number(params[id]);
    }
    return snapshot;
}

/**
 * Ensure a managed preset exists for this slot. If absent, create it by
 * snapshotting current settings (assumed to be the profile's just-applied
 * baseline) + overlaying the slot's tuned params. If present, update it
 * in case the user changed params since last write.
 *
 * MUST be called only AFTER the slot's profile has been switched in,
 * because we use the live API state as the snapshot baseline.
 *
 * @param {object} slot — slot with `tuning.enabled = true`
 * @param {string} queueName
 * @returns {Promise<string|null>} managed preset name, or null if API unsupported
 */
export async function ensureManagedPreset(slot, queueName) {
    if (!slot.tuning?.enabled) return null;
    const apiId = resolveApiIdForProfile(slot.profileName);
    if (!apiId) return null;
    const presetMgr = getPresetManager(apiId);
    if (!presetMgr) return null;

    const desiredName = managedPresetName(slot, queueName);
    const snapshot = snapshotCurrentSettings(apiId);
    if (!snapshot) return null;
    const tunedSettings = overlayParams(snapshot, slot.tuning.params, apiId);

    // savePreset() handles both create and update by name. skipUpdate
    // keeps it from triggering a UI refresh (we don't want to flash the
    // preset selector during rotation).
    try {
        await presetMgr.savePreset(desiredName, tunedSettings, { skipUpdate: true });
    } catch (err) {
        console.error('[Roulette] managed preset save failed:', err);
        return null;
    }

    slot.tuning.presetName = desiredName;
    return desiredName;
}

/**
 * Public entry point: called from events.js right after a successful
 * switchProfile. If the slot has tuning enabled, this ensures the managed
 * preset exists and applies it via /preset. The internal-switch flag is
 * set during the /preset call so our CONNECTION_PROFILE_LOADED listener
 * doesn't trip a manual-override.
 *
 * @param {object} slot
 * @param {object} queue
 * @returns {Promise<boolean>} true if tuning was applied, false if skipped/no-op
 */
export async function applyTuningOnSwitch(slot, queue) {
    if (!slot?.tuning?.enabled) return false;
    const presetName = await ensureManagedPreset(slot, queue?.name ?? 'queue');
    if (!presetName) return false;
    try {
        // Quote the name because [Roulette] · etc. contains characters that
        // could confuse the slash-command parser otherwise.
        const escaped = String(presetName).replace(/"/g, '\\"');
        await executeSlashCommandsWithOptions(`/preset "${escaped}"`, { showOutput: false });
        return true;
    } catch (err) {
        console.error('[Roulette] /preset apply failed:', err);
        return false;
    }
}

/**
 * Delete the managed preset for a slot if one exists. Safe to call when
 * tuning is absent — no-ops cleanly. Called on slot deletion, tuning
 * disable, and queue deletion.
 *
 * @param {object} slot
 * @returns {Promise<boolean>} true if a preset was deleted
 */
export async function cleanupManagedPresetForSlot(slot) {
    const presetName = slot?.tuning?.presetName;
    if (!presetName) return false;
    const apiId = resolveApiIdForProfile(slot.profileName);
    if (!apiId) {
        // Profile no longer resolvable — best effort: try every API's
        // preset manager and let one pick it up.
        for (const id of Object.keys(API_PARAM_MAP)) {
            const mgr = getPresetManager(id);
            if (mgr && mgr.getAllPresets().includes(presetName)) {
                try { await mgr.deletePreset(presetName); } catch (_) { /* ignore */ }
                break;
            }
        }
        slot.tuning.presetName = null;
        return true;
    }
    const mgr = getPresetManager(apiId);
    if (!mgr) {
        slot.tuning.presetName = null;
        return false;
    }
    if (!mgr.getAllPresets().includes(presetName)) {
        slot.tuning.presetName = null;
        return false;
    }
    try {
        await mgr.deletePreset(presetName);
        slot.tuning.presetName = null;
        return true;
    } catch (err) {
        console.error('[Roulette] managed preset cleanup failed:', err);
        return false;
    }
}

/**
 * Cleanup helper for queue deletion: walk every slot, delete every
 * managed preset.
 */
export async function cleanupManagedPresetsForQueue(queue) {
    if (!queue || !Array.isArray(queue.slots)) return;
    for (const slot of queue.slots) {
        await cleanupManagedPresetForSlot(slot);
    }
}

/**
 * For the UI: read the current live value of a param from the API's
 * settings object. Used as the slider initial value when the user opens
 * tuning for the first time.
 */
export function readLiveParam(apiId, paramId) {
    const fields = fieldsForApi(apiId);
    const spec = fields?.[paramId];
    const live = API_PARAM_MAP[apiId]?.settingsObj?.();
    if (!spec || !live) return null;
    const v = live[spec.key];
    return Number.isFinite(v) ? Number(v) : null;
}

// Quiet warning suppress: isInternalSwitch is currently imported for future
// use (tuning may need to flag its own preset switch as internal). Keeping
// the import to avoid churn when that lands.
void isInternalSwitch;
