/* SillyTavern-Roulette — AGPL-3.0
 *
 * Wraps SillyTavern's `/profile` slash command with:
 *   - exact-name validation against extension_settings.connectionManager.profiles
 *     (ST's /profile fuzzy-matches via Fuse, so we MUST validate ourselves
 *     before firing — a typo'd slot name shouldn't silently swap providers)
 *   - an isInternalSwitch flag exposed to the CONNECTION_PROFILE_LOADED
 *     handler so our own switches don't trip the manual-override path
 *   - awaiting `await=true` so the switch is synchronous from our side
 */

import { extension_settings } from '../../../../../scripts/extensions.js';
import { executeSlashCommandsWithOptions } from '../../../../../scripts/slash-commands.js';

let _isInternalSwitch = false;

/** True while we're driving a `/profile` switch ourselves. */
export function isInternalSwitch() {
    return _isInternalSwitch;
}

/**
 * Names of all currently-defined connection profiles. Read live every time —
 * never cache (the user can add/remove profiles between calls).
 *
 * @returns {string[]}
 */
export function listProfileNames() {
    const profiles = extension_settings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles.map(p => p?.name).filter(n => typeof n === 'string' && n.length > 0);
}

/**
 * True if a profile by this exact name exists.
 */
export function profileExists(name) {
    if (!name) return false;
    return listProfileNames().includes(name);
}

/**
 * Switch to the named connection profile. Returns true on success.
 *
 * On failure (profile missing, slash command threw, etc.) returns false; the
 * caller decides how to handle that (skip the slot, surface a toast, etc.).
 *
 * Sets `isInternalSwitch()` to true for the duration of the await.
 *
 * @param {string} profileName
 * @returns {Promise<boolean>}
 */
export async function switchProfile(profileName) {
    if (!profileExists(profileName)) {
        console.warn(`[Roulette] switchProfile: profile "${profileName}" not found`);
        return false;
    }
    _isInternalSwitch = true;
    try {
        const escaped = String(profileName).replace(/"/g, '\\"');
        await executeSlashCommandsWithOptions(`/profile await=true "${escaped}"`, {
            showOutput: false,
        });
        return true;
    } catch (err) {
        console.error('[Roulette] /profile failed:', err);
        return false;
    } finally {
        // Defer clearing the flag by a tick so any synchronous
        // CONNECTION_PROFILE_LOADED listeners that fire after the slash
        // command resolves still see the flag set.
        queueMicrotask(() => {
            _isInternalSwitch = false;
        });
    }
}
