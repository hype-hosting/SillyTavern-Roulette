/* SillyTavern-Roulette — AGPL-3.0
 *
 * JSON export / import for queue definitions. Files contain either a single
 * queue object or an array of queue objects (the same shape used in
 * extension_settings.roulette.queues). On import, every queue gets a fresh
 * id so we never collide with an existing one.
 */

import { validateQueue } from './rotation.js';
import { upsertQueue, getSettings } from './state.js';

const FILE_SCHEMA_VERSION = 1;

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'q-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

function slug(s) {
    return String(s ?? 'queue')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'queue';
}

/**
 * Trigger a JSON file download in the browser.
 */
function download(filename, obj) {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Wrap a queue object in the export envelope.
 */
function envelope(queueOrArray) {
    return {
        kind: 'sillytavern-roulette',
        schema: FILE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        ...(Array.isArray(queueOrArray)
            ? { queues: queueOrArray }
            : { queue: queueOrArray }),
    };
}

/**
 * Export a single queue to a downloaded JSON file.
 */
export function exportQueue(queue) {
    const filename = `roulette-queue-${slug(queue.name)}.json`;
    download(filename, envelope(queue));
}

/**
 * Export all queues to a single downloaded JSON file.
 */
export function exportAllQueues() {
    const queues = getSettings().queues;
    download('roulette-queues.json', envelope(queues));
}

/**
 * Strip non-portable fields and reissue ids before insertion.
 *
 * @param {object} q
 * @returns {object} sanitised queue ready for upsertQueue
 */
function sanitiseImported(q) {
    return {
        ...q,
        id: uuid(),
        name: typeof q.name === 'string' && q.name.trim() ? q.name : 'Imported Queue',
        slots: Array.isArray(q.slots)
            ? q.slots.map(s => ({ ...s, id: s.id || uuid() }))
            : [],
    };
}

/**
 * Read a File handle from a file input, parse, validate, import every
 * contained queue. Returns counts of imported / rejected queues.
 *
 * @param {File} file
 * @returns {Promise<{imported: number, rejected: Array<{name: string, errors: string[]}>}>}
 */
export async function importQueueFile(file) {
    const text = await file.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new Error(`Could not parse JSON: ${err.message}`);
    }

    let candidates = [];
    if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.queues)) candidates = parsed.queues;
        else if (parsed.queue) candidates = [parsed.queue];
        else if (Array.isArray(parsed)) candidates = parsed;
        else if (parsed.slots && parsed.mode) candidates = [parsed]; // bare queue
    }

    if (candidates.length === 0) {
        throw new Error('No queues found in file.');
    }

    const rejected = [];
    let imported = 0;
    for (const raw of candidates) {
        const queue = sanitiseImported(raw);
        const errors = validateQueue(queue);
        if (errors.length) {
            rejected.push({ name: queue.name, errors });
            continue;
        }
        upsertQueue(queue);
        imported++;
    }
    return { imported, rejected };
}
