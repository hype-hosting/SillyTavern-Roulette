/* SillyTavern-Roulette — AGPL-3.0
 *
 * "Which characters auto-start this queue?" picker, opened from a queue card
 * in the Queues tab.
 *
 * The relationship is one-queue-per-character but many-characters-per-queue,
 * so checking a character who is already bound elsewhere REBINDS them — the
 * row calls that out inline rather than letting the user discover it by
 * surprise afterwards.
 *
 * Rows are built as DOM nodes with textContent rather than interpolated
 * HTML: character names are user-supplied and land in this list verbatim.
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../scripts/popup.js';
import { getSettings } from '../state.js';
import {
    listCharacters,
    charactersBoundTo,
    getBoundQueueId,
    setBinding,
    clearBinding,
} from '../characterBinding.js';

/**
 * Open the character picker for a queue. Resolves once the user has saved or
 * cancelled; bindings are written only on save.
 *
 * @param {object} queue
 * @returns {Promise<boolean>} true if bindings were changed
 */
export async function openBindingPicker(queue) {
    const queueNameById = new Map(getSettings().queues.map(q => [q.id, q.name]));

    // Everything ST currently knows about, plus any binding on this queue
    // whose character has since vanished — those would otherwise be
    // invisible and impossible to clear from the UI.
    const known = listCharacters();
    const knownKeys = new Set(known.map(c => c.key));
    const orphans = charactersBoundTo(queue.id).filter(c => !knownKeys.has(c.key));
    const rows = [...known, ...orphans.map(o => ({ ...o, missing: true }))];

    // key -> checked. Seeded from the queue's current bindings.
    const selection = new Map(
        rows.map(c => [c.key, getBoundQueueId(c.key) === queue.id]),
    );

    const root = document.createElement('div');
    root.className = 'roulette-extension roulette-binding-picker';

    const header = document.createElement('div');
    header.className = 'roulette-section-title';
    header.textContent = 'Auto-start this queue for…';
    root.appendChild(header);

    const blurb = document.createElement('p');
    blurb.className = 'roulette-text-muted roulette-binding-blurb';
    blurb.textContent = `Opening a chat with a checked character starts "${queue.name}" automatically, `
        + 'unless that chat already has a rotation running or you stopped one there.';
    root.appendChild(blurb);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'roulette-binding-search text_pole';
    search.placeholder = 'Filter characters…';
    root.appendChild(search);

    const list = document.createElement('div');
    list.className = 'roulette-binding-list';
    root.appendChild(list);

    const empty = document.createElement('p');
    empty.className = 'roulette-text-muted';
    empty.textContent = 'No characters match.';
    empty.hidden = true;
    root.appendChild(empty);

    function renderList() {
        const needle = search.value.trim().toLowerCase();
        list.innerHTML = '';
        let shown = 0;
        for (const character of rows) {
            if (needle && !character.name.toLowerCase().includes(needle)) continue;
            shown++;
            list.appendChild(buildRow(character));
        }
        empty.hidden = shown > 0;
    }

    function buildRow(character) {
        const row = document.createElement('label');
        row.className = 'roulette-binding-row';

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = selection.get(character.key) === true;
        box.addEventListener('change', () => selection.set(character.key, box.checked));
        row.appendChild(box);

        const name = document.createElement('span');
        name.className = 'roulette-binding-name';
        name.textContent = character.name;
        row.appendChild(name);

        if (character.missing) {
            row.appendChild(note('roulette-binding-note-missing', 'character no longer exists'));
        } else {
            const boundTo = getBoundQueueId(character.key);
            if (boundTo && boundTo !== queue.id) {
                const otherName = queueNameById.get(boundTo) ?? 'another queue';
                row.appendChild(note('roulette-binding-note-conflict', `currently ${otherName}`));
            }
        }
        return row;
    }

    function note(className, text) {
        const el = document.createElement('span');
        el.className = `roulette-binding-note ${className}`;
        el.textContent = text;
        return el;
    }

    search.addEventListener('input', renderList);
    renderList();

    if (rows.length === 0) {
        list.remove();
        search.remove();
        empty.hidden = false;
        empty.textContent = 'No characters found. Add a character card in SillyTavern first.';
    }

    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Save bindings',
        cancelButton: 'Cancel',
        allowVerticalScrolling: true,
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return false;

    let changed = false;
    for (const [key, checked] of selection) {
        const current = getBoundQueueId(key);
        if (checked && current !== queue.id) {
            setBinding(key, queue.id);
            changed = true;
        } else if (!checked && current === queue.id) {
            clearBinding(key);
            changed = true;
        }
    }
    return changed;
}
