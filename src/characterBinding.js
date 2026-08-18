/* SillyTavern-Roulette — AGPL-3.0
 *
 * Per-character queue bindings: "when this character is loaded, run this
 * queue." Every piece of ST character-identity handling lives here so the
 * rest of the extension never has to think about it.
 *
 * Two rules drive the whole module:
 *
 *  1. Characters are keyed by AVATAR FILENAME, never by `this_chid`.
 *     `this_chid` is an index into the live `characters` array — it shifts
 *     whenever a character is added, deleted, or the list is re-sorted, so
 *     persisting it would silently re-point bindings at the wrong character.
 *     The avatar filename is what ST core and every bundled extension
 *     (quick-reply, gallery, attachments, stats) uses for per-character
 *     storage, so we match it.
 *
 *  2. Group chats are excluded. `getCurrentCharacter()` returns null while a
 *     group is selected, which makes every binding path inert there. This
 *     matches quick-reply's per-character config, which bails on
 *     `selected_group` for the same reason: a group has several members and
 *     no non-arbitrary answer to "whose binding wins?".
 *
 * Avatar filenames are stable but not immutable — renaming a character
 * rewrites it. `remapBinding()` is wired to CHARACTER_RENAMED and
 * `purgeBindingsForCharacter()` to CHARACTER_DELETED (see src/events.js) to
 * keep the map from rotting.
 */

import { getContext } from '../../../../../scripts/extensions.js';
import { getSettings, persistSettings } from './state.js';

/**
 * The binding map: { [avatarFilename]: queueId }.
 * Always reached through getSettings() so the backfill runs.
 */
function bindings() {
    return getSettings().characterQueues;
}

/**
 * True while a group chat is selected.
 * @returns {boolean}
 */
export function isGroupChat() {
    return !!getContext()?.groupId;
}

/**
 * The character the chat is currently pointed at.
 *
 * Returns null when a group chat is open or no character is loaded — callers
 * can treat null as "bindings do not apply right now".
 *
 * Never cache this. `getContext()` snapshots `this_chid` at call time, and
 * the user can change character at any moment.
 *
 * @returns {{key: string, name: string} | null}
 */
export function getCurrentCharacter() {
    const ctx = getContext();
    if (!ctx || ctx.groupId) return null;
    const character = ctx.characters?.[ctx.characterId];
    if (!character?.avatar) return null;
    return { key: character.avatar, name: character.name || prettifyKey(character.avatar) };
}

/**
 * Every character ST knows about, for binding pickers.
 * Sorted by display name so the picker is scannable.
 *
 * @returns {Array<{key: string, name: string}>}
 */
export function listCharacters() {
    const characters = getContext()?.characters ?? [];
    return characters
        .filter(c => c?.avatar)
        .map(c => ({ key: c.avatar, name: c.name || prettifyKey(c.avatar) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The queue bound to a character, if any.
 *
 * @param {string} characterKey avatar filename
 * @returns {string|null} queue id
 */
export function getBoundQueueId(characterKey) {
    if (!characterKey) return null;
    return bindings()[characterKey] ?? null;
}

/**
 * Bind a character to a queue. Persists.
 *
 * A character has at most one queue, so this overwrites any previous
 * binding for that character.
 *
 * @param {string} characterKey avatar filename
 * @param {string} queueId
 */
export function setBinding(characterKey, queueId) {
    if (!characterKey || !queueId) return;
    bindings()[characterKey] = queueId;
    persistSettings();
}

/**
 * Remove a character's binding. Persists. Returns true if one existed.
 *
 * @param {string} characterKey avatar filename
 * @returns {boolean}
 */
export function clearBinding(characterKey) {
    if (!characterKey) return false;
    const map = bindings();
    if (!(characterKey in map)) return false;
    delete map[characterKey];
    persistSettings();
    return true;
}

/**
 * Every character bound to a given queue.
 *
 * Characters that no longer exist in ST still appear (with a name derived
 * from the avatar filename) rather than vanishing silently — otherwise a
 * stale binding would be invisible and unremovable from the UI.
 *
 * @param {string} queueId
 * @returns {Array<{key: string, name: string, missing: boolean}>}
 */
export function charactersBoundTo(queueId) {
    if (!queueId) return [];
    const known = new Map(listCharacters().map(c => [c.key, c.name]));
    return Object.entries(bindings())
        .filter(([, boundId]) => boundId === queueId)
        .map(([key]) => ({
            key,
            name: known.get(key) ?? prettifyKey(key),
            missing: !known.has(key),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How many characters are bound to a queue (for the queue-card chip).
 *
 * @param {string} queueId
 * @returns {number}
 */
export function bindingCountForQueue(queueId) {
    if (!queueId) return 0;
    return Object.values(bindings()).filter(id => id === queueId).length;
}

/**
 * Drop a deleted character's binding. Wired to CHARACTER_DELETED, which
 * emits `{ id, character }`.
 *
 * @param {string} avatar
 * @returns {boolean} true if a binding was removed
 */
export function purgeBindingsForCharacter(avatar) {
    return clearBinding(avatar);
}

/**
 * Follow a character through a rename. Wired to CHARACTER_RENAMED, which
 * emits `(oldAvatar, newAvatar)` — the avatar filename is derived from the
 * character name, so renaming changes our storage key.
 *
 * @param {string} oldAvatar
 * @param {string} newAvatar
 * @returns {boolean} true if a binding was moved
 */
export function remapBinding(oldAvatar, newAvatar) {
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return false;
    const map = bindings();
    if (!(oldAvatar in map)) return false;
    map[newAvatar] = map[oldAvatar];
    delete map[oldAvatar];
    persistSettings();
    return true;
}

/**
 * Human-readable fallback for an avatar filename ("Seraphina.png" ->
 * "Seraphina"). Used when the character has no name, or no longer exists.
 */
function prettifyKey(key) {
    return String(key ?? '').replace(/\.(png|webp|jpe?g|gif)$/i, '');
}
