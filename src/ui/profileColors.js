/* SillyTavern-Roulette — AGPL-3.0
 *
 * Hash-based stable color assignment for connection profiles. Same name →
 * same color, every time, across reloads — so users build muscle memory
 * for "the green one is GPT-4."
 *
 * v2.0: the dot strip made these colours the extension's entire
 * visualisation, so the palette is tuned for maximum mutual separation at
 * the 8px the pinned bar renders them, against the cool near-black canvas.
 * Every swatch clears 4.5:1 against --roulette-bg (#0c0d11).
 */

const PALETTE = [
    '#6ea8fe', // blue
    '#5ed3a0', // green
    '#ff7a7a', // red
    '#c79bff', // violet
    '#ffc861', // amber
    '#4fd1e0', // cyan
    '#ff8fc7', // pink
    '#a8d95f', // lime
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
