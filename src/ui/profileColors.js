/* SillyTavern-Roulette — AGPL-3.0
 *
 * Hash-based stable color assignment for connection profiles. Same name →
 * same color, every time, across reloads — so users build muscle memory
 * for "the green one is GPT-4." Curated 8-swatch palette tuned to read
 * cleanly against the brass-on-charcoal modal canvas.
 */

const PALETTE = [
    '#c7a461', // brass
    '#6fbf73', // emerald
    '#d96666', // crimson
    '#6ba8c7', // teal
    '#b87dd9', // amethyst
    '#d99c66', // copper
    '#66c7b2', // mint
    '#c76b9c', // rose
];

function hash(s) {
    let h = 5381;
    const str = String(s ?? '');
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    return h >>> 0;
}

export function colorForProfile(name) {
    if (!name) return null;
    return PALETTE[hash(name) % PALETTE.length];
}

export function profileColorPalette() {
    return PALETTE.slice();
}
