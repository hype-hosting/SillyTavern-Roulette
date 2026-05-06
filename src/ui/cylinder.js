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

/**
 * @param {object} options
 * @param {Array<{id, profileName?, weight?}>} options.slots
 * @param {string|null} options.activeSlotId
 * @param {'sequential'|'weighted-random'} options.mode
 * @param {boolean} options.mini      true = queue-card thumbnail variant
 * @param {number}  options.responsesRemaining  for the active chamber's pip ring (step 5)
 * @returns {SVGSVGElement}
 */
export function renderCylinder({
    slots = [],
    activeSlotId = null,
    mode = 'sequential',
    mini = false,
    // responsesRemaining unused in step 2; landed in step 5
} = {}) {
    const N = slots.length;
    const viewBox = mini ? 100 : 400;
    const center = viewBox / 2;
    const outerR = mini ? 46 : 180;
    const collarThick = mini ? 4 : 10;
    const hubR = mini ? 9 : 40;
    const ringR = mini ? 30 : 120;

    const svg = el('svg', {
        viewBox: `0 0 ${viewBox} ${viewBox}`,
        class: mini ? 'roulette-cylinder roulette-cylinder-mini' : 'roulette-cylinder',
        xmlns: SVG_NS,
        role: 'img',
        'aria-label': mini ? 'Queue preview' : 'Roulette cylinder',
    });

    const defs = el('defs', {}, svg);
    const glassId = nextId('glass');
    const glassActiveId = nextId('glass-active');
    const collarId = nextId('collar');

    // Idle chamber glass (subtle gloss top-left, shadow bottom-right).
    const grad = el('radialGradient', {
        id: glassId, cx: '32%', cy: '28%', r: '78%',
    }, defs);
    el('stop', { offset: '0%',  'stop-color': 'rgba(255,250,240,0.22)' }, grad);
    el('stop', { offset: '55%', 'stop-color': 'rgba(255,250,240,0.05)' }, grad);
    el('stop', { offset: '100%', 'stop-color': 'rgba(0,0,0,0.30)' }, grad);

    // Active chamber glass (warm brass-tinted core).
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

    // Group everything inside a rotation pivot — step 4 will animate this.
    const pivot = el('g', {
        class: 'roulette-cylinder-pivot',
        transform: `rotate(0 ${center} ${center})`,
        'data-pivot': 'true',
    }, svg);

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

    // Hub.
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
    // Hub gloss
    el('ellipse', {
        cx: center - hubR * 0.25, cy: center - hubR * 0.4,
        rx: hubR * 0.4, ry: hubR * 0.18,
        fill: 'rgba(255,250,240,0.18)',
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

            // Glassy capsule fill.
            el('circle', {
                cx: 0, cy: 0, r,
                fill: `url(#${isActive ? glassActiveId : glassId})`,
                stroke: isActive ? 'var(--roulette-accent)' : 'rgba(0,0,0,0.5)',
                'stroke-width': mini ? 0.4 : 0.8,
                opacity: isEmpty ? 0.55 : 1,
            }, g);

            // Top gloss crescent.
            const arcR = r * 0.82;
            el('path', {
                d: `M ${-arcR * 0.85} ${-r * 0.18} A ${arcR} ${arcR} 0 0 1 ${arcR * 0.85} ${-r * 0.18}`,
                fill: 'none',
                stroke: 'rgba(255,250,240,0.5)',
                'stroke-width': mini ? 0.7 : 1.3,
                'stroke-linecap': 'round',
                opacity: isEmpty ? 0.25 : (isActive ? 0.85 : 0.55),
            }, g);

            // Lower shadow crescent (for the glass volume effect).
            el('path', {
                d: `M ${-arcR * 0.7} ${r * 0.4} A ${arcR * 0.85} ${arcR * 0.85} 0 0 0 ${arcR * 0.7} ${r * 0.4}`,
                fill: 'none',
                stroke: 'rgba(0,0,0,0.35)',
                'stroke-width': mini ? 0.5 : 1,
                'stroke-linecap': 'round',
                opacity: 0.7,
            }, g);

            // Label.
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
                }, g);
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
