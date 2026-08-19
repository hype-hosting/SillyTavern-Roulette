/* SillyTavern-Roulette — AGPL-3.0
 *
 * Tests for the pure scheduling core. src/rotation.js imports nothing, so it
 * runs under plain node with no browser, no SillyTavern, and no mocks.
 *
 *   npm test        (or: node --test tests/)
 *
 * Scope is deliberately narrow: this covers the logic that is easy to get
 * subtly wrong and expensive to check by hand — slot sequencing, the
 * no-repeat guarantee, and the auto-activation precedence rules. Anything
 * that touches ST's event system or DOM is verified manually per TESTING.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    pickInitialSlot,
    advanceSlot,
    decideAutoActivation,
    isCountableGeneration,
    emptyState,
    validateQueue,
} from '../src/rotation.js';

/** Deterministic PRNG so weighted-random assertions don't flake. */
function mulberry32(seed) {
    return function rng() {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sequentialQueue() {
    return {
        id: 'q1',
        name: 'Test',
        mode: 'sequential',
        slots: [
            { id: 'a', profileName: 'A', countMode: 'fixed', fixedCount: 3 },
            { id: 'b', profileName: 'B', countMode: 'fixed', fixedCount: 2 },
            { id: 'c', profileName: 'C', countMode: 'fixed', fixedCount: 4 },
        ],
    };
}

/**
 * Replay the scheduler's real per-message order:
 *   GENERATION_STARTED (advance if the counter is spent)
 *   -> the model generates with whatever slot is current
 *   -> MESSAGE_RECEIVED (decrement)
 */
function simulate(queue, messageCount, rng = Math.random) {
    const pick = pickInitialSlot(queue, rng);
    let index = pick.slotIndex;
    let remaining = pick.responses;
    const produced = [];

    for (let i = 0; i < messageCount; i++) {
        if (remaining <= 0) {
            const next = advanceSlot(queue, index, [], rng);
            index = next.slotIndex;
            remaining = next.responses;
        }
        produced.push(queue.slots[index].profileName);
        remaining--;
    }
    return produced;
}

test('sequential fixed counts run each slot for its full allotment', () => {
    // The canonical A=3, B=2, C=4 walk from CLAUDE.md's acceptance criteria.
    assert.deepEqual(
        simulate(sequentialQueue(), 9),
        ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'C', 'C'],
    );
});

test('sequential wraps back to the first slot after the last', () => {
    assert.deepEqual(
        simulate(sequentialQueue(), 12).slice(9),
        ['A', 'A', 'A'],
    );
});

test('noRepeatInRow never picks the same slot twice running', () => {
    const queue = {
        id: 'q2',
        name: 'Random',
        mode: 'weighted-random',
        noRepeatInRow: true,
        weightedRunCount: { mode: 'fixed', fixed: 1 },
        slots: [
            { id: 'a', profileName: 'A', weight: 1 },
            { id: 'b', profileName: 'B', weight: 1 },
            { id: 'c', profileName: 'C', weight: 1 },
        ],
    };
    const produced = simulate(queue, 200, mulberry32(42));
    for (let i = 1; i < produced.length; i++) {
        assert.notEqual(produced[i], produced[i - 1], `repeat at index ${i}`);
    }
});

test('equal weights distribute roughly evenly', () => {
    const queue = {
        id: 'q3',
        name: 'Even',
        mode: 'weighted-random',
        weightedRunCount: { mode: 'fixed', fixed: 1 },
        slots: [
            { id: 'a', profileName: 'A', weight: 1 },
            { id: 'b', profileName: 'B', weight: 1 },
            { id: 'c', profileName: 'C', weight: 1 },
        ],
    };
    const produced = simulate(queue, 900, mulberry32(7));
    for (const name of ['A', 'B', 'C']) {
        const count = produced.filter(p => p === name).length;
        assert.ok(count > 220 && count < 380, `${name} used ${count} times, expected ~300`);
    }
});

test('swipes, regens and continues do not consume a slot', () => {
    for (const type of ['swipe', 'regenerate', 'continue', 'append', 'appendFinal', 'impersonate', 'quiet', 'first_message']) {
        assert.equal(isCountableGeneration(type), false, `${type} should not count`);
    }
    assert.equal(isCountableGeneration(undefined), true);
    assert.equal(isCountableGeneration(null), true);
    assert.equal(isCountableGeneration('normal'), true);
});

test('the type filter is a whitelist — unknown types fail closed', () => {
    // 'command' (/sendas) and 'extension' (e.g. stable-diffusion) exist in
    // today's ST; 'some-future-type' stands in for whatever comes next.
    // None of them may consume rotation slots.
    for (const type of ['command', 'extension', 'some-future-type', '']) {
        assert.equal(isCountableGeneration(type), false, `"${type}" should not count`);
    }
});

test('validateQueue rejects non-numeric count fields regardless of countMode', () => {
    // The editor renders every count field (the inactive ones merely hidden),
    // so a hostile value in a countMode-inactive field would reach the DOM.
    // An imported queue must not get that far.
    const queue = sequentialQueue();
    queue.slots[0].countMode = 'range';
    queue.slots[0].minCount = 1;
    queue.slots[0].maxCount = 2;
    queue.slots[0].fixedCount = '"><img src=x onerror=alert(1)>';
    const errors = validateQueue(queue);
    assert.ok(errors.some(e => e.includes('fixedCount')), `expected a fixedCount error, got: ${errors.join(' | ')}`);
});

test('validateQueue accepts absent inactive count fields', () => {
    const queue = sequentialQueue();
    delete queue.slots[0].minCount;
    delete queue.slots[0].maxCount;
    delete queue.slots[0].weight;
    assert.deepEqual(validateQueue(queue), []);
});

/* ------------------------------------------------------------------
 * Character-binding auto-activation precedence
 * ------------------------------------------------------------------ */

const boundAndFresh = {
    hasCharacter: true,
    boundQueueId: 'q1',
    queueExists: true,
    chatState: emptyState(),
};

test('a fresh chat with a bound character starts the queue', () => {
    assert.equal(decideAutoActivation(boundAndFresh).action, 'start');
});

test('group chats and empty character slots are inert', () => {
    assert.equal(
        decideAutoActivation({ ...boundAndFresh, hasCharacter: false }).action,
        'none',
    );
});

test('an unbound character starts nothing', () => {
    assert.equal(
        decideAutoActivation({ ...boundAndFresh, boundQueueId: null }).action,
        'none',
    );
});

test('a rotation already running is never clobbered', () => {
    const decision = decideAutoActivation({
        ...boundAndFresh,
        chatState: { ...emptyState(), activeQueueId: 'something-else' },
    });
    assert.equal(decision.action, 'mark-handled');
});

test('a rotation the user stopped stays stopped across reloads', () => {
    // This is the guarantee that makes auto-start tolerable: stopRotation()
    // latches autoBindHandled, so reopening the chat must not restart it.
    const decision = decideAutoActivation({
        ...boundAndFresh,
        chatState: { ...emptyState(), activeQueueId: null, autoBindHandled: true },
    });
    assert.equal(decision.action, 'none');
});

test('a binding pointing at a deleted queue is dropped', () => {
    assert.equal(
        decideAutoActivation({ ...boundAndFresh, queueExists: false }).action,
        'clear-binding',
    );
});

test('a running rotation takes precedence over cleaning up a stale binding', () => {
    // Ordering matters: we must not mutate settings while a rotation the user
    // cares about is mid-flight.
    const decision = decideAutoActivation({
        ...boundAndFresh,
        queueExists: false,
        chatState: { ...emptyState(), activeQueueId: 'running' },
    });
    assert.equal(decision.action, 'mark-handled');
});
