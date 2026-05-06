/* SillyTavern-Roulette — AGPL-3.0
 *
 * Glassy revolver-cylinder SVG component. Two variants:
 *   renderCylinder({...})       full size — Chamber tab hero
 *   renderCylinder({mini:true}) ~100x100 — queue cards
 *
 * Pure render: takes a queue snapshot in, returns an SVGElement out.
 * No event wiring here — the parent attaches click/hover handlers.
 *
 * Visual anatomy:
 *   - outer brass collar (two concentric rings, lit on top-left)
 *   - center hub (the cylinder's pivot bolt)
 *   - firing-position notch above chamber 0 (full-size only)
 *   - N chambers in a ring around the hub, each a glassy capsule with
 *     gloss highlight on its upper edge
 *   - active chamber gets a soft outer halo + brass-tinted fill
 *
 * Weighted-random mode visualises weight via chamber radius
 * (sqrt of weight ratio so visual area matches odds). Sequential mode
 * uses uniform chamber sizes — every slot looks identical.
 */

import { colorForProfile } from './profileColors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let gradId = 0;
function nextId(prefix) {
    return `${prefix}-${++gradId}`;
}

function el(tag, attrs = {}, parent = null) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v != null && v !== false) e.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(e);
    return e;
}

function truncate(s, max) {
    if (!s) return '';
    if (s.length <= max) return s;
    return s.slice(0, Math.max(1, max - 1)) + '…';
}

function describeForScreenReader({ slots, activeSlotId, mode, mini, responsesRemaining, responsesAllotted }) {
    if (mini) return `Queue preview, ${slots.length} chambers`;
    const N = slots.length;
    if (N === 0) return 'Roulette cylinder, no chambers loaded';
    const active = slots.find(s => s.id === activeSlotId);
    const head = `Roulette cylinder, ${mode}, ${N} chambers`;
    if (active) {
        const counter = responsesAllotted > 0
            ? `, ${responsesRemaining} of ${responsesAllotted} responses left`
            : '';
        return `${head}. Active: ${active.profileName ?? 'unnamed'}${counter}`;
    }
    return `${head}. Idle`;
}

/**
 * Rotation angle (in degrees) that brings the slot at `activeIndex` to the
 * firing position (top of the ring). Sequential mode uses this directly;
 * weighted-random mode adds extra revolutions on top of it.
 */
export function rotationForActiveIndex(activeIndex, totalSlots) {
    if (activeIndex < 0 || totalSlots <= 0) return 0;
    return -(activeIndex * (360 / totalSlots));
}

/**
 * Compute the next target angle given the cylinder's current angle, the
 * slot index we want at the top, and the rotation mode. Always returns a
 * value <= currentAngle so the cylinder spins clockwise visually.
 *
 * For 'weighted-random' the cylinder adds 3-5 extra revolutions so the spin
 * has a wheel-of-fortune feel; for 'sequential' it just takes the short
 * clockwise path.
 */
export function computeSpinTargetAngle(currentAngle, targetIndex, totalSlots, mode = 'sequential') {
    const base = rotationForActiveIndex(targetIndex, totalSlots);
    // Find an equivalent of `base` that's near `currentAngle` (within ±180°).
    let near = base;
    while (near - currentAngle > 180) near -= 360;
    while (near - currentAngle < -180) near += 360;
    if (mode === 'weighted-random') {
        // 3-5 extra full revolutions, always clockwise (negative). Must be
        // an integer number of revolutions so the cylinder lands EXACTLY
        // on `near` and the active chamber settles at firing position.
        const extraRevolutions = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
        return near - 360 * extraRevolutions;
    }
    // Sequential — bias to clockwise, so equal-distance ties prefer the
    // negative direction.
    if (near > currentAngle) near -= 360;
    return near;
}

/**
 * Animate the cylinder's pivot from its current angle to the slot at
 * `targetIndex`. Returns a Promise that resolves when the spin settles.
 *
 * The pivot rotates with CSS transitions; counter-rotate groups (chamber
 * decorations, hub gloss) animate in lock-step via SVG transform
 * attribute transitions so labels stay world-upright.
 */
export function spinCylinderTo(svg, targetIndex, totalSlots, mode = 'sequential') {
    if (!svg) return Promise.resolve();
    const pivot = svg.querySelector('.roulette-cylinder-pivot');
    if (!pivot) return Promise.resolve();
    const currentAngle = Number(svg.dataset.cylinderAngle ?? '0');
    const target = computeSpinTargetAngle(currentAngle, targetIndex, totalSlots, mode);
    pivot.classList.toggle('roulette-cylinder-spinning-weighted', mode === 'weighted-random');
    pivot.classList.add('roulette-cylinder-spinning');
    svg.dataset.cylinderAngle = String(target);
    pivot.style.transform = `rotate(${target}deg)`;
    applyCounterRotation(svg, target);
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            pivot.removeEventListener('transitionend', onEnd);
            pivot.classList.remove('roulette-cylinder-spinning');
            // Normalise stored angle to within (-360, 360] to keep numbers
            // small over many spins.
            const normalised = target - Math.trunc(target / 360) * 360;
            svg.dataset.cylinderAngle = String(normalised);
            pivot.style.transition = 'none';
            pivot.style.transform = `rotate(${normalised}deg)`;
            applyCounterRotation(svg, normalised, /*instant=*/true);
            void pivot.offsetWidth;
            pivot.style.transition = '';
            resolve();
        };
        const onEnd = (e) => {
            if (e.propertyName === 'transform') finish();
        };
        pivot.addEventListener('transitionend', onEnd);
        setTimeout(finish, mode === 'weighted-random' ? 1900 : 700);
    });
}

/**
 * Set the SVG `transform` attribute on every counter-rotation group to
 * `rotate(-angle)` so decorations stay upright. With CSS transitions on
 * those elements, this triggers a smooth animation in lock-step with the
 * pivot. When `instant` is true, transitions are suspended for one frame
 * so the post-spin angle normalisation doesn't visually re-spin labels.
 */
export function applyCounterRotation(svg, angle, instant = false) {
    const counters = svg.querySelectorAll('.roulette-counter-rotate');
    if (instant) {
        counters.forEach(g => {
            g.style.transition = 'none';
            // Hub-counter uses absolute centre (translate around viewBox
            // centre); chamber-counter uses local origin at the chamber
            // centre. We can't tell from class alone, so read the previous
            // attribute and rebuild.
            const prev = g.getAttribute('transform') ?? '';
            g.setAttribute('transform', rebuildCounterTransform(prev, angle));
        });
        // Restore transitions next frame.
        requestAnimationFrame(() => {
            counters.forEach(g => { g.style.transition = ''; });
        });
    } else {
        counters.forEach(g => {
            const prev = g.getAttribute('transform') ?? '';
            g.setAttribute('transform', rebuildCounterTransform(prev, angle));
        });
    }
}

/**
 * Replace the rotation portion of an existing transform attribute. Hub
 * counter-rotates around the viewBox centre (matching the pivot's origin);
 * chamber decorations counter-rotate around their local (0, 0) which is
 * the chamber centre after the parent's translate. We distinguish by
 * looking at the prior transform string for centre coordinates.
 */
function rebuildCounterTransform(prev, angle) {
    const center = extractRotationCenter(prev);
    return center
        ? `rotate(${-angle} ${center.x} ${center.y})`
        : `rotate(${-angle})`;
}

function extractRotationCenter(transform) {
    const m = String(transform).match(/rotate\(\s*[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*\)/);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
}

/**
 * @param {object} options
 * @param {Array<{id, profileName?, weight?}>} options.slots
 * @param {string|null} options.activeSlotId
 * @param {'sequential'|'weighted-random'} options.mode
 * @param {boolean} options.mini       true = queue-card thumbnail variant
 * @param {number|null} options.initialAngle  pre-set rotation (degrees)
 * @param {number} options.responsesRemaining  responses left in active slot
 * @param {number} options.responsesAllotted   total responses for this slot
 * @returns {SVGSVGElement}
 */
export function renderCylinder({
    slots = [],
    activeSlotId = null,
    mode = 'sequential',
    mini = false,
    initialAngle = null,
    responsesRemaining = 0,
    responsesAllotted = 0,
} = {}) {
    const N = slots.length;
    const viewBox = mini ? 100 : 400;
    const center = viewBox / 2;
    const outerR = mini ? 46 : 180;
    const collarThick = mini ? 4 : 10;
    const hubR = mini ? 9 : 40;
    const ringR = mini ? 30 : 120;

    const ariaLabel = describeForScreenReader({ slots, activeSlotId, mode, mini, responsesRemaining, responsesAllotted });
    const svg = el('svg', {
        viewBox: `0 0 ${viewBox} ${viewBox}`,
        class: mini ? 'roulette-cylinder roulette-cylinder-mini' : 'roulette-cylinder',
        xmlns: SVG_NS,
        role: 'img',
        'aria-label': ariaLabel,
    });

    const defs = el('defs', {}, svg);
    const glassActiveId = nextId('glass-active');
    const collarId = nextId('collar');

    // Active chamber glass — centred brass-tinted glow. Chambers in the
    // idle state use a flat translucent fill (no gradient), so they read
    // as clean glassy disks rather than off-centre spheres.
    const gradA = el('radialGradient', {
        id: glassActiveId, cx: '50%', cy: '50%', r: '75%',
    }, defs);
    el('stop', { offset: '0%',  'stop-color': 'rgba(199,164,97,0.55)' }, gradA);
    el('stop', { offset: '60%', 'stop-color': 'rgba(199,164,97,0.20)' }, gradA);
    el('stop', { offset: '100%', 'stop-color': 'rgba(199,164,97,0.04)' }, gradA);

    // Collar gradient (bevel).
    const collarG = el('linearGradient', {
        id: collarId, x1: '20%', y1: '0%', x2: '80%', y2: '100%',
    }, defs);
    el('stop', { offset: '0%',  'stop-color': '#d8b876' }, collarG);
    el('stop', { offset: '50%', 'stop-color': '#7a623a' }, collarG);
    el('stop', { offset: '100%', 'stop-color': '#3a2f1c' }, collarG);

    // Group everything inside a rotation pivot. CSS transform on this group
    // drives spin animations; SVG `transform` attribute is left blank
    // because CSS transform takes precedence.
    const activeIndex = activeSlotId
        ? slots.findIndex(s => s.id === activeSlotId)
        : -1;
    const startAngle = initialAngle != null
        ? Number(initialAngle)
        : rotationForActiveIndex(activeIndex, N);
    svg.dataset.cylinderAngle = String(startAngle);
    const pivot = el('g', {
        class: 'roulette-cylinder-pivot',
        'data-pivot': 'true',
        // No transition on initial render — applied via class so subsequent
        // angle changes animate.
        style: `transform: rotate(${startAngle}deg); transition: none;`,
    }, svg);
    // Re-enable transitions on the next frame so subsequent spinCylinderTo
    // calls animate.
    requestAnimationFrame(() => {
        pivot.style.transition = '';
    });

    // Outer brass collar — two concentric circles for a beveled look.
    el('circle', {
        cx: center, cy: center, r: outerR,
        fill: 'none',
        stroke: `url(#${collarId})`,
        'stroke-width': collarThick,
        opacity: 0.9,
    }, pivot);
    el('circle', {
        cx: center, cy: center, r: outerR - collarThick * 0.55,
        fill: 'none',
        stroke: 'var(--roulette-accent)',
        'stroke-width': mini ? 0.8 : 1.4,
        opacity: 0.55,
    }, pivot);
    // Inner shadow line just inside the collar.
    el('circle', {
        cx: center, cy: center, r: outerR - collarThick * 1.1,
        fill: 'none',
        stroke: 'rgba(0,0,0,0.45)',
        'stroke-width': mini ? 0.5 : 1,
    }, pivot);

    // Hub — two concentric brass-bordered circles. No gloss highlight; the
    // user wanted the centre kept clean.
    el('circle', {
        cx: center, cy: center, r: hubR,
        fill: 'var(--roulette-surface-2)',
        stroke: 'var(--roulette-accent-soft)',
        'stroke-width': mini ? 0.8 : 1.4,
    }, pivot);
    el('circle', {
        cx: center, cy: center, r: hubR * 0.55,
        fill: 'var(--roulette-surface)',
        stroke: 'var(--roulette-accent-soft)',
        'stroke-width': mini ? 0.4 : 0.8,
        opacity: 0.6,
    }, pivot);

    // Chambers
    if (N === 0) {
        const t = el('text', {
            x: center, y: center + (mini ? 0 : hubR + 30),
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            fill: 'var(--roulette-text-dim)',
            'font-size': mini ? 9 : 13,
            'font-style': 'italic',
        }, svg);
        t.textContent = mini ? '∅' : 'No chambers loaded';
    } else {
        const totalWeight = mode === 'weighted-random'
            ? slots.reduce((s, x) => s + Math.max(0.05, Number(x.weight ?? 1)), 0)
            : N;
        // Base chamber radius scales down with N to keep them inside the ring.
        const arcLen = (2 * Math.PI * ringR) / N;
        const baseR = Math.min(
            mini ? 14 : 50,
            arcLen * 0.42,
            (outerR - hubR - collarThick * 1.5) * 0.46,
        );

        slots.forEach((slot, i) => {
            const angle = (i / N) * Math.PI * 2 - Math.PI / 2; // chamber 0 at top
            const cx = center + ringR * Math.cos(angle);
            const cy = center + ringR * Math.sin(angle);

            let r = baseR;
            if (mode === 'weighted-random') {
                const w = Math.max(0.05, Number(slot.weight ?? 1));
                const ratio = w / (totalWeight / N);
                r = baseR * Math.sqrt(Math.max(0.4, Math.min(1.7, ratio)));
            }

            const isActive = slot.id === activeSlotId;
            const isEmpty = !slot.profileName;

            const g = el('g', {
                class: [
                    'roulette-chamber',
                    isActive ? 'roulette-chamber-active' : '',
                    isEmpty ? 'roulette-chamber-empty' : '',
                ].filter(Boolean).join(' '),
                'data-slot-id': slot.id,
                transform: `translate(${cx}, ${cy})`,
            }, pivot);

            // Halo behind active chamber (full-size only).
            if (isActive && !mini) {
                el('circle', {
                    cx: 0, cy: 0, r: r + 12,
                    fill: 'var(--roulette-glow)',
                    opacity: 0.75,
                    filter: 'blur(10px)',
                    class: 'roulette-chamber-halo',
                }, g);
            }

            // Outer brass ring (chamber border).
            el('circle', {
                cx: 0, cy: 0, r: r + (mini ? 0.5 : 1),
                fill: 'none',
                stroke: 'var(--roulette-accent-soft)',
                'stroke-width': isActive ? (mini ? 1.4 : 2.4) : (mini ? 0.7 : 1.2),
                opacity: isActive ? 1 : (isEmpty ? 0.35 : 0.75),
            }, g);

            // Chamber fill. Active chambers get the centred brass glow
            // gradient; idle chambers get a flat translucent fill so they
            // read as clean glassy disks (no off-centre sphere effect).
            el('circle', {
                cx: 0, cy: 0, r,
                fill: isActive ? `url(#${glassActiveId})` : 'rgba(255,250,240,0.04)',
                stroke: isActive ? 'var(--roulette-accent)' : 'rgba(0,0,0,0.45)',
                'stroke-width': mini ? 0.4 : 0.8,
                opacity: isEmpty ? 0.55 : 1,
            }, g);

            // Label lives in a counter-rotating group so it stays
            // world-upright while the chamber body travels with the
            // cylinder. Both transitions share the same duration so the
            // counter-rotation tracks the pivot's spin.
            const content = el('g', {
                class: 'roulette-counter-rotate',
                transform: `rotate(${-startAngle})`,
            }, g);

            // Label — full-size only; mini variant uses the centred dot.
            if (!mini) {
                const fontSize = Math.max(8, Math.min(13, r * 0.34));
                const maxChars = Math.max(3, Math.floor(r / 4.5));
                const label = el('text', {
                    x: 0, y: 0,
                    'text-anchor': 'middle',
                    'dominant-baseline': 'middle',
                    'font-size': fontSize,
                    'font-weight': isActive ? 600 : 500,
                    fill: isEmpty
                        ? 'var(--roulette-text-dim)'
                        : (isActive ? 'var(--roulette-text)' : colorForProfile(slot.profileName)),
                    'pointer-events': 'none',
                }, content);
                label.textContent = isEmpty ? '·' : truncate(slot.profileName, maxChars);
                if (slot.profileName) {
                    const title = el('title', {}, g);
                    title.textContent = slot.profileName;
                }
            } else if (!isEmpty) {
                el('circle', {
                    cx: 0, cy: 0, r: r * 0.42,
                    fill: colorForProfile(slot.profileName),
                    opacity: isActive ? 1 : 0.7,
                }, g);
            }

            // Pip ring around the active chamber — one pip per response in
            // the slot's allotment; dimmed pips have been consumed.
            if (isActive && !mini && responsesAllotted > 0) {
                const pipR = 3;
                const pipDist = r + 9;
                for (let p = 0; p < Math.min(responsesAllotted, 24); p++) {
                    const pa = (p / responsesAllotted) * Math.PI * 2 - Math.PI / 2;
                    const px = pipDist * Math.cos(pa);
                    const py = pipDist * Math.sin(pa);
                    const lit = p < responsesRemaining;
                    el('circle', {
                        cx: px, cy: py, r: pipR,
                        fill: 'var(--roulette-accent)',
                        opacity: lit ? 1 : 0.22,
                        class: `roulette-pip ${lit ? '' : 'roulette-pip-dim'}`,
                        'data-pip-index': p,
                    }, g);
                }
            }
        });
    }

    // Firing-position notch — outside the pivot so it doesn't rotate with
    // the cylinder during step-4 spin animations.
    if (!mini) {
        const notchTipY = center - outerR + collarThick * 0.4;
        const notchBaseY = center - outerR - 18;
        el('path', {
            d: `M ${center - 9} ${notchBaseY} L ${center + 9} ${notchBaseY} L ${center} ${notchTipY} Z`,
            fill: 'var(--roulette-accent)',
            class: 'roulette-firing-notch',
            opacity: 0.95,
        }, svg);
        el('path', {
            d: `M ${center - 6} ${notchBaseY + 1} L ${center + 6} ${notchBaseY + 1} L ${center} ${notchTipY - 2} Z`,
            fill: 'rgba(255,250,240,0.35)',
            opacity: 0.6,
        }, svg);
    }

    return svg;
}
