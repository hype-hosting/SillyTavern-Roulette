/* SillyTavern-Roulette — AGPL-3.0
 *
 * Linear dot strip — the extension's whole visualisation as of v2.0,
 * replacing the revolver cylinder.
 *
 * One dot per slot, in queue order, coloured by the slot's connection
 * profile. The slot currently generating grows into a lit capsule carrying
 * the number of responses it has left; everything else stays a small dot.
 *
 * Plain DOM, not SVG. The cylinder needed SVG for its rotation pivot and
 * counter-rotating labels; a straight line needs none of that, and CSS
 * transitions on plain spans give smoother growth than animating SVG
 * geometry would.
 *
 * Three variants, differing only in scale (all sizing lives in CSS):
 *   'bar'   — the pinned status bar
 *   'panel' — the modal's Rotation tab hero
 *   'card'  — queue-card thumbnails (no active state, no numeral)
 *
 * Public API:
 *   mountDotStrip(host, opts)  — render or patch in place; returns the element
 *   describeStrip(opts)        — the screen-reader sentence, exported for reuse
 *   weightSteps(slots, mode)   — weight → size rung; exported for tests
 */

import { colorForProfile } from './profileColors.js';

/** Beyond this many slots a variant windows the strip instead of overflowing. */
const MAX_DOTS = { bar: 12, panel: 24, card: 8 };

/** Counts wider than this render as "99+" so the capsule keeps its shape. */
const MAX_COUNT = 99;

/**
 * Render a dot strip into `host`, or patch the one already there.
 *
 * Patching matters: the counter ticks on every message, and rebuilding the
 * DOM each time would restart the CSS transitions mid-flight and kill the
 * grow/shrink animation as the active slot moves. So the strip's *shape*
 * (which slots, what order, which variant) is fingerprinted; identical
 * fingerprint means patch, anything else means rebuild.
 *
 * @param {HTMLElement} host
 * @param {object} opts — see buildStrip()
 * @returns {HTMLElement} the strip element
 */
export function mountDotStrip(host, opts) {
    const slots = opts.slots ?? [];
    const win = windowFor(slots, opts);
    const steps = weightSteps(slots, opts.mode ?? 'sequential');
    const key = stripKey(opts, win, steps);
    const existing = host.firstElementChild;
    if (existing && existing.dataset.stripKey === key) {
        patchStrip(existing, opts);
        return existing;
    }
    const el = buildStrip(opts, win, key, steps);
    host.replaceChildren(el);
    return el;
}

/**
 * Fingerprint of everything that changes the strip's structure. Deliberately
 * excludes activeSlotId, responsesRemaining, paused and idle — those are
 * exactly the things patchStrip() can apply without a rebuild. The rendered
 * window IS part of the fingerprint: on queues longer than the variant's cap
 * the window follows the active slot, and a strip patched against a stale
 * window would simply lose its active capsule once rotation walked past the
 * edge. A window shift means dots enter and leave, so that rebuild is
 * unavoidable anyway.
 */
function stripKey(opts, win, steps) {
    const { slots = [], mode = 'sequential', variant = 'bar' } = opts;
    const shape = slots
        .map((s, i) => `${s.id}:${s.profileName ?? ''}:${steps[i]}`)
        .join('|');
    return `${variant}/${mode}/${shape}@${win.from}-${win.to}`;
}

/**
 * @param {object} opts
 * @param {Array<{id, profileName?, weight?}>} opts.slots
 * @param {string|null} opts.activeSlotId    slot currently generating
 * @param {'sequential'|'weighted-random'} opts.mode
 * @param {'bar'|'panel'|'card'} opts.variant
 * @param {number} opts.responsesRemaining   shown inside the active dot
 * @param {number} opts.responsesAllotted    total for the active slot (aria only)
 * @param {boolean} opts.paused              manual override in effect
 * @param {boolean} opts.idle                no rotation running — dots render hollow
 * @returns {HTMLElement}
 */
function buildStrip(opts, win, key, steps) {
    const {
        slots = [],
        variant = 'bar',
    } = opts;

    const strip = document.createElement('div');
    strip.className = `roulette-dots roulette-dots-${variant}`;
    strip.dataset.stripKey = key;
    strip.setAttribute('role', 'img');

    if (slots.length === 0) {
        strip.classList.add('roulette-dots-empty');
        const hint = document.createElement('span');
        hint.className = 'roulette-dots-placeholder';
        hint.textContent = variant === 'card' ? '—' : 'no slots';
        strip.appendChild(hint);
        applyStripState(strip, opts);
        return strip;
    }

    const { from, to, cutStart, cutEnd } = win;

    if (cutStart) strip.appendChild(buildEllipsis(from));
    for (let i = from; i < to; i++) {
        strip.appendChild(buildDot(slots[i], i, steps[i], opts));
    }
    if (cutEnd) strip.appendChild(buildEllipsis(slots.length - to));

    applyStripState(strip, opts);
    return strip;
}

/**
 * Which slice of the slots to show. Long queues would otherwise either
 * overflow the bar or squash every dot to nothing, so past the variant's cap
 * we show a window — always one that contains the active slot, since a strip
 * that hides the thing it is reporting on is worse than useless.
 */
function windowFor(slots, opts) {
    const { variant = 'bar', activeSlotId = null } = opts;
    const cap = MAX_DOTS[variant] ?? MAX_DOTS.bar;
    if (slots.length <= cap) {
        return { from: 0, to: slots.length, cutStart: 0, cutEnd: 0 };
    }
    const activeIndex = activeSlotId ? slots.findIndex(s => s.id === activeSlotId) : -1;
    // Centre on the active slot; fall back to the head of the queue when idle.
    const anchor = activeIndex >= 0 ? activeIndex : 0;
    let from = Math.max(0, anchor - Math.floor(cap / 2));
    from = Math.min(from, slots.length - cap);
    const to = from + cap;
    return { from, to, cutStart: from, cutEnd: slots.length - to };
}

function buildEllipsis(count) {
    const chip = document.createElement('span');
    chip.className = 'roulette-dots-more';
    chip.textContent = `+${count}`;
    chip.title = `${count} more slot${count === 1 ? '' : 's'}`;
    return chip;
}

/**
 * The five size steps a weighted dot can take, as CSS keywords. Each maps to
 * a whole-pixel diameter per variant in style.css, growing by area so the
 * ladder still reads as "twice the odds, twice the ink".
 */
const WEIGHT_LADDER = ['xs', 'sm', 'md', 'lg', 'xl'];

/** Upper bound (exclusive) on weight÷mean for each step below the largest. */
const WEIGHT_BREAKS = [0.55, 0.8, 1.25, 1.8];

/** The step every dot gets outside weighted-random mode. */
const NEUTRAL_STEP = 'md';

/**
 * Map each slot to a size step from its weight relative to the queue's mean.
 *
 * Discrete on purpose. This used to be a continuous multiplier —
 * sqrt(weight/mean), clamped — written into a `--dot-scale` custom property
 * and multiplied against the variant's base size in CSS. That produced
 * fractional diameters (9px × 0.844 = 7.594px), and a fractionally-sized box
 * gets snapped to the device-pixel grid *independently* in x and y: painted
 * width is round(x + w) − round(x), painted height round(y + h) − round(y),
 * and those disagree whenever the dot's x and y origins have different
 * fractional parts. At 7–15px a one-pixel disagreement is a visibly squashed
 * circle, and two slots of equal weight could land on different snappings and
 * paint at different sizes — both of which users reported.
 *
 * Whole-pixel diameters fix both: round(x + w) − round(x) === w exactly when
 * w is an integer, whatever x is. So the ladder is quantised here and the
 * pixel values live in CSS, one per variant per step.
 *
 * The lost granularity costs nothing real — a 4% diameter difference on a
 * 9px dot was never perceptible, it just made the snapping look arbitrary.
 *
 * @param {Array<{weight?: number}>} slots
 * @param {string} mode
 * @returns {string[]} one step keyword per slot, parallel to `slots`
 */
export function weightSteps(slots, mode) {
    if (mode !== 'weighted-random' || slots.length === 0) {
        return slots.map(() => NEUTRAL_STEP);
    }
    const weights = slots.map(s => Math.max(0.05, Number(s.weight ?? 1)));
    const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
    if (!(mean > 0)) return slots.map(() => NEUTRAL_STEP);
    return weights.map(w => {
        const ratio = w / mean;
        const i = WEIGHT_BREAKS.findIndex(bound => ratio < bound);
        return WEIGHT_LADDER[i === -1 ? WEIGHT_LADDER.length - 1 : i];
    });
}

function buildDot(slot, index, step, opts) {
    const dot = document.createElement('span');
    dot.className = 'roulette-dot';
    dot.dataset.slotId = slot.id;
    dot.dataset.slotIndex = String(index);

    const isEmpty = !slot.profileName;
    if (isEmpty) {
        dot.classList.add('roulette-dot-empty');
        dot.title = `Slot ${index + 1} — no profile assigned`;
    } else {
        dot.style.setProperty('--dot-color', colorForProfile(slot.profileName));
        dot.title = slot.profileName;
    }
    if (step !== NEUTRAL_STEP) dot.dataset.weight = step;

    // The numeral node exists on every dot, empty until the dot goes active.
    // Creating it up front means patchStrip() only ever sets textContent —
    // no node churn on the hot path.
    const count = document.createElement('span');
    count.className = 'roulette-dot-count';
    dot.appendChild(count);

    applyDotState(dot, slot, opts);
    return dot;
}

/**
 * Everything patchStrip() needs to (re)apply to a single dot.
 */
function applyDotState(dot, slot, opts) {
    const { activeSlotId = null, variant = 'bar', responsesRemaining = 0 } = opts;
    // Card thumbnails are a static read of the queue's shape — no live slot.
    const isActive = variant !== 'card' && !!activeSlotId && slot.id === activeSlotId;
    dot.classList.toggle('roulette-dot-active', isActive);

    const countEl = dot.querySelector('.roulette-dot-count');
    if (!countEl) return;
    if (isActive && Number.isFinite(responsesRemaining) && responsesRemaining > 0) {
        countEl.textContent = responsesRemaining > MAX_COUNT ? `${MAX_COUNT}+` : String(responsesRemaining);
        dot.classList.add('roulette-dot-counted');
    } else {
        countEl.textContent = '';
        dot.classList.remove('roulette-dot-counted');
    }
}

function applyStripState(strip, opts) {
    const { idle = false, paused = false } = opts;
    strip.classList.toggle('roulette-dots-idle', !!idle);
    strip.classList.toggle('roulette-dots-paused', !!paused);
    strip.setAttribute('aria-label', describeStrip(opts));
}

/**
 * Patch a strip whose shape is unchanged: move the active state, update the
 * numeral, refresh idle/paused. Never touches structure.
 */
function patchStrip(strip, opts) {
    const { slots = [] } = opts;
    const byId = new Map(slots.map(s => [s.id, s]));
    strip.querySelectorAll('.roulette-dot').forEach(dot => {
        const slot = byId.get(dot.dataset.slotId);
        if (!slot) return;
        const wasActive = dot.classList.contains('roulette-dot-active');
        applyDotState(dot, slot, opts);
        // Flash the dot that just became active, so a switch reads as an
        // event even when the strip is small enough that the size change
        // alone is easy to miss.
        if (!wasActive && dot.classList.contains('roulette-dot-active')) {
            flash(dot);
        }
    });
    applyStripState(strip, opts);
}

function flash(dot) {
    dot.classList.remove('roulette-dot-igniting');
    // Force a reflow so re-adding the class restarts the animation even when
    // two switches land back to back.
    void dot.offsetWidth;
    dot.classList.add('roulette-dot-igniting');
    // Remove on the animation's own completion — its duration is divided by
    // the user's animation-speed setting, so a wall-clock timeout would cut
    // the flare short at slow speeds. A lingering class is inert (the
    // animation is one-shot), so no fallback timer is needed.
    dot.addEventListener('animationend',
        () => dot.classList.remove('roulette-dot-igniting'),
        { once: true });
}

/**
 * One-sentence description of what the strip is showing, for screen readers.
 *
 * @param {object} opts
 * @returns {string}
 */
export function describeStrip(opts) {
    const {
        slots = [],
        activeSlotId = null,
        mode = 'sequential',
        variant = 'bar',
        responsesRemaining = 0,
        responsesAllotted = 0,
        paused = false,
        idle = false,
    } = opts;

    const modeLabel = mode === 'weighted-random' ? 'weighted random' : 'sequential';
    if (slots.length === 0) return 'Roulette: no slots in this queue';
    if (variant === 'card') return `Queue preview, ${modeLabel}, ${slots.length} slots`;

    const head = `Roulette, ${modeLabel}, ${slots.length} slots`;
    if (idle || !activeSlotId) return `${head}. Not running`;

    const active = slots.find(s => s.id === activeSlotId);
    const name = active?.profileName || 'unassigned slot';
    const counter = responsesAllotted > 0
        ? `, ${responsesRemaining} of ${responsesAllotted} responses left`
        : '';
    return `${head}. Active: ${name}${counter}${paused ? ', paused by manual override' : ''}`;
}
