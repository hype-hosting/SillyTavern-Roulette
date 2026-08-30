/* SillyTavern-Roulette — AGPL-3.0
 *
 * Tests for the dot strip's weight → size ladder.
 *
 * src/ui/dotStrip.js touches the DOM only inside its render functions, so the
 * ladder itself imports and runs under plain node like src/rotation.js does.
 * Rendering stays a manual check per TESTING.md.
 *
 * These guard a bug users actually hit: weighted-random queues drew visibly
 * elliptical dots, and two slots of *equal* weight drew at different sizes.
 * The cause was a continuous scale multiplier producing fractional diameters
 * (9px x 0.844 = 7.594px), which browsers snap to the device-pixel grid
 * independently per axis. The invariants below — equal weights land on the
 * same rung, and every rung is a whole pixel — are what keep the dots round.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { weightSteps } from '../src/ui/dotStrip.js';

const slotsWith = (...weights) => weights.map((weight, i) => ({ id: `s${i}`, weight }));

test('slots of equal weight always land on the same rung', () => {
    // The reported case: five slots, two sharing a weight, and the user could
    // see that the two matching ones were not drawn alike.
    const steps = weightSteps(slotsWith(2, 2, 1, 1, 1), 'weighted-random');
    assert.equal(steps[0], steps[1]);
    assert.deepEqual(steps.slice(2), [steps[2], steps[2], steps[2]]);
    assert.notEqual(steps[0], steps[2], 'a 2:1 weight difference should still be visible');
});

test('an all-equal queue renders every dot at the neutral rung', () => {
    assert.deepEqual(weightSteps(slotsWith(1, 1, 1), 'weighted-random'), ['md', 'md', 'md']);
    // Equal-but-not-one weights are still equal.
    assert.deepEqual(weightSteps(slotsWith(7, 7, 7), 'weighted-random'), ['md', 'md', 'md']);
});

test('sequential mode ignores weights entirely', () => {
    assert.deepEqual(weightSteps(slotsWith(9, 1, 1), 'sequential'), ['md', 'md', 'md']);
});

test('rung size is monotonic in weight', () => {
    const order = ['xs', 'sm', 'md', 'lg', 'xl'];
    const steps = weightSteps(slotsWith(1, 2, 3, 8, 20), 'weighted-random');
    const ranks = steps.map(s => order.indexOf(s));
    assert.ok(ranks.every(r => r >= 0), `unknown rung in ${steps.join(',')}`);
    for (let i = 1; i < ranks.length; i++) {
        assert.ok(ranks[i] >= ranks[i - 1], `weight went up but the dot did not: ${steps.join(',')}`);
    }
});

test('extreme weight ratios clamp instead of running off the ladder', () => {
    // A 1000:1 ratio is meaningful as odds but unreadable as a dot 30x wider
    // than its neighbour, so the ladder saturates at both ends.
    assert.deepEqual(weightSteps(slotsWith(1, 1000), 'weighted-random'), ['xs', 'xl']);
});

test('missing, zero and junk weights fall back instead of throwing', () => {
    assert.deepEqual(weightSteps([{ id: 'a' }, { id: 'b' }], 'weighted-random'), ['md', 'md']);
    assert.deepEqual(weightSteps([{ id: 'a', weight: 0 }], 'weighted-random'), ['md']);
    assert.deepEqual(weightSteps([{ id: 'a', weight: null }], 'weighted-random'), ['md']);
    assert.deepEqual(weightSteps(slotsWith(0, 0, 0), 'weighted-random'), ['md', 'md', 'md']);
});

test('an empty queue produces no steps', () => {
    assert.deepEqual(weightSteps([], 'weighted-random'), []);
    assert.deepEqual(weightSteps([], 'sequential'), []);
});

test('every dot size in the stylesheet is a whole number of pixels', () => {
    // This is the invariant that keeps the dots round. A fractional diameter
    // paints round(x + w) - round(x) wide and round(y + h) - round(y) tall,
    // and those disagree whenever the x and y origins have different
    // fractional parts. Whole pixels make both exactly w for any origin.
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const decls = [...css.matchAll(/--dot-(?:size|active-size)[\w-]*\s*:\s*([^;]+);/g)];

    assert.ok(decls.length >= 12, `expected the full ladder, found ${decls.length} declarations`);
    for (const [, value] of decls) {
        const raw = value.trim();
        if (raw.startsWith('var(')) continue;   // rung aliases resolve to the values below
        assert.match(raw, /^\d+px$/, `dot size "${raw}" must be a whole number of pixels`);
    }
});

test('the stylesheet no longer scales dots by a fractional multiplier', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const sizing = css.match(/^\s*(?:min-)?(?:width|height)\s*:[^;]*--dot-scale[^;]*;/gm) ?? [];
    assert.deepEqual(sizing, [], 'dot sizing must not multiply by --dot-scale');
});
