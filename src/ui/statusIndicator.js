/* SillyTavern-Roulette — AGPL-3.0
 *
 * Persistent status pill mounted in the chat input area (#leftSendForm).
 * Click to open a small popover with stop/skip/resume actions.
 */

import { findQueue, getChatState } from '../state.js';
import { onRotationStateChanged, stopRotation, skipCurrentSlot, resumeRotation } from '../events.js';

let pillEl = null;
let popoverEl = null;

export function mountStatusIndicator() {
    if (pillEl) return;
    const target = document.getElementById('leftSendForm') ?? document.getElementById('send_form');
    if (!target) {
        console.warn('[Roulette] no chat input mount point found; status indicator skipped');
        return;
    }
    pillEl = document.createElement('div');
    pillEl.className = 'roulette-extension roulette-pill';
    pillEl.tabIndex = 0;
    pillEl.title = 'Roulette';
    pillEl.addEventListener('click', togglePopover);
    pillEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePopover(); }
    });
    target.appendChild(pillEl);

    onRotationStateChanged(render);
    render();
}

function togglePopover() {
    if (popoverEl) { closePopover(); return; }
    const state = getChatState();
    if (!state.activeQueueId) return;
    popoverEl = document.createElement('div');
    popoverEl.className = 'roulette-extension roulette-popover';
    renderPopover(state);
    document.body.appendChild(popoverEl);
    positionPopover();

    setTimeout(() => {
        document.addEventListener('mousedown', onDocClick, { once: true });
    }, 0);
}
function onDocClick(e) {
    if (popoverEl && !popoverEl.contains(e.target) && e.target !== pillEl) {
        closePopover();
    } else if (popoverEl) {
        document.addEventListener('mousedown', onDocClick, { once: true });
    }
}
function closePopover() {
    if (popoverEl) {
        popoverEl.remove();
        popoverEl = null;
    }
}
function positionPopover() {
    if (!pillEl || !popoverEl) return;
    const r = pillEl.getBoundingClientRect();
    popoverEl.style.position = 'fixed';
    popoverEl.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`;
    popoverEl.style.left = `${Math.round(r.left)}px`;
    popoverEl.style.zIndex = '10000';
}

function renderPopover(state) {
    const queue = findQueue(state.activeQueueId);
    const slot = queue?.slots.find(s => s.id === state.currentSlotId);
    popoverEl.innerHTML = `
        <div class="roulette-popover-row">
            <div><b>${escapeHtml(queue?.name ?? '?')}</b></div>
            <div>Profile: ${escapeHtml(slot?.profileName ?? '?')}</div>
            <div>${state.responsesRemaining} response(s) left in this slot</div>
            ${state.manuallyOverridden ? '<div class="roulette-warn">Paused: manual override</div>' : ''}
        </div>
        <div class="roulette-popover-actions">
            ${state.manuallyOverridden ? '<button class="menu_button" data-act="resume" type="button">Resume</button>' : ''}
            <button class="menu_button" data-act="skip" type="button">Skip slot</button>
            <button class="menu_button" data-act="stop" type="button">Stop rotation</button>
        </div>
    `;
    popoverEl.querySelector('[data-act="stop"]')?.addEventListener('click', () => { stopRotation(); closePopover(); });
    popoverEl.querySelector('[data-act="skip"]')?.addEventListener('click', async () => { await skipCurrentSlot(); closePopover(); });
    popoverEl.querySelector('[data-act="resume"]')?.addEventListener('click', () => { resumeRotation(); closePopover(); });
}

function render() {
    if (!pillEl) return;
    const state = getChatState();
    if (!state.activeQueueId) {
        pillEl.classList.add('roulette-pill-off');
        pillEl.innerHTML = `<i class="fa-solid fa-dice"></i>`;
        pillEl.title = 'Roulette: off';
        if (popoverEl) closePopover();
        return;
    }
    pillEl.classList.remove('roulette-pill-off');
    const queue = findQueue(state.activeQueueId);
    const slot = queue?.slots.find(s => s.id === state.currentSlotId);
    const profile = slot?.profileName ?? '?';
    const left = state.responsesRemaining;
    const paused = state.manuallyOverridden;
    pillEl.innerHTML = `
        <i class="fa-solid fa-dice"></i>
        <span class="roulette-pill-text">
            ${escapeHtml(queue?.name ?? '?')} · ${escapeHtml(profile)} · ${left}${paused ? ' · paused' : ''}
        </span>
    `;
    pillEl.title = paused
        ? 'Roulette paused (manual override) — click to resume/stop'
        : `Roulette: ${queue?.name ?? '?'} (click for options)`;

    if (popoverEl) renderPopover(state);
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
