/* SillyTavern-Roulette — AGPL-3.0
 *
 * Persistent status pill mounted in the chat input area (#leftSendForm).
 * Clicking opens the full Roulette modal at the Chamber tab. The
 * pill itself is a compact glance — queue name, current profile,
 * responses-left, paused flag.
 */

import { findQueue, getChatState } from '../state.js';
import { onRotationStateChanged } from '../events.js';
import { openRouletteModal } from './modal.js';

let pillEl = null;

export function mountStatusIndicator() {
    if (pillEl) return;
    const target = document.getElementById('leftSendForm') ?? document.getElementById('send_form');
    if (!target) {
        console.warn('[Roulette] no chat input mount point found; status indicator skipped');
        return;
    }
    pillEl = document.createElement('button');
    pillEl.type = 'button';
    pillEl.className = 'roulette-extension roulette-pill';
    pillEl.setAttribute('aria-label', 'Open Roulette');
    pillEl.addEventListener('click', () => openRouletteModal('chamber'));
    target.appendChild(pillEl);

    onRotationStateChanged(render);
    render();
}

function render() {
    if (!pillEl) return;
    const state = getChatState();
    if (!state.activeQueueId) {
        pillEl.classList.add('roulette-pill-off');
        pillEl.innerHTML = `<i class="fa-solid fa-circle-dot"></i>`;
        pillEl.title = 'Roulette: off — click to open';
        return;
    }
    pillEl.classList.remove('roulette-pill-off');
    const queue = findQueue(state.activeQueueId);
    const slot = queue?.slots.find(s => s.id === state.currentSlotId);
    const profile = slot?.profileName ?? '?';
    const left = state.responsesRemaining;
    const paused = state.manuallyOverridden;
    pillEl.innerHTML = `
        <i class="fa-solid fa-circle-dot"></i>
        <span class="roulette-pill-text">
            ${escapeHtml(queue?.name ?? '?')} · ${escapeHtml(profile)} · ${left}${paused ? ' · paused' : ''}
        </span>
    `;
    pillEl.title = paused
        ? 'Roulette paused (manual override) — click to open'
        : `Roulette: ${queue?.name ?? '?'} — click to open`;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
