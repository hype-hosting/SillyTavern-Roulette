/* SillyTavern-Roulette — AGPL-3.0
 *
 * History tab — per-chat sequence of which profile generated which message.
 * Two surfaces:
 *   - "Trail strip": last 12 picks as a row of dots, newest on the right,
 *     colour-coded by profile. Reads at a glance.
 *   - Detail list: full history newest-first (capped at most-recent 100
 *     to keep the DOM lean) with #id, profile, time.
 *
 * Source: chat_metadata.roulette.history (already populated by events.js).
 */

import { getChatState } from '../../state.js';
import { colorForProfile } from '../profileColors.js';

const TRAIL_LENGTH = 12;
const LIST_CAP = 100;

export function mountHistoryTab(container) {
    container.innerHTML = `
        <div class="roulette-history-layout">
            <div class="roulette-history-header">
                <div class="roulette-section-title">Recent picks</div>
                <div class="roulette-history-count" data-field="count">0</div>
            </div>
            <div class="roulette-history-trail" data-field="trail"></div>
            <div class="roulette-history-list" data-field="list"></div>
            <div class="roulette-history-empty hidden" data-field="empty">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <p>No messages yet for this chat.</p>
                <p class="roulette-text-muted">History records every AI response and which profile produced it.</p>
            </div>
        </div>
    `;
    refreshHistoryTab(container);
}

export function refreshHistoryTab(container) {
    if (!container) return;
    const trailEl = container.querySelector('[data-field="trail"]');
    const listEl = container.querySelector('[data-field="list"]');
    const emptyEl = container.querySelector('[data-field="empty"]');
    const countEl = container.querySelector('[data-field="count"]');
    if (!trailEl || !listEl) return;

    const state = getChatState();
    const history = Array.isArray(state.history) ? state.history : [];
    countEl.textContent = `${history.length} pick${history.length === 1 ? '' : 's'}`;

    if (history.length === 0) {
        trailEl.innerHTML = '';
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');

    // Trail: last TRAIL_LENGTH entries, oldest on the left, newest on the
    // right. Colour by profile. Most-recent dot has a soft halo.
    const trailEntries = history.slice(-TRAIL_LENGTH);
    trailEl.innerHTML = '';
    const padding = TRAIL_LENGTH - trailEntries.length;
    for (let i = 0; i < padding; i++) {
        const dot = document.createElement('span');
        dot.className = 'roulette-trail-dot roulette-trail-dot-empty';
        trailEl.appendChild(dot);
    }
    trailEntries.forEach((entry, i) => {
        const isNewest = i === trailEntries.length - 1;
        const dot = document.createElement('span');
        dot.className = `roulette-trail-dot${isNewest ? ' roulette-trail-dot-newest' : ''}`;
        const c = colorForProfile(entry.profileName);
        if (c) dot.style.backgroundColor = c;
        const title = `#${entry.messageId} · ${entry.profileName ?? '?'} · ${formatTime(entry.timestamp)}`;
        dot.title = title;
        trailEl.appendChild(dot);
    });

    // Detail list, newest-first, capped at LIST_CAP.
    const recent = history.slice(-LIST_CAP).reverse();
    listEl.innerHTML = '';
    for (const entry of recent) {
        const row = document.createElement('div');
        row.className = 'roulette-history-row';
        const c = colorForProfile(entry.profileName) ?? 'var(--roulette-text-dim)';
        row.innerHTML = `
            <span class="roulette-history-dot" style="background:${c}"></span>
            <span class="roulette-history-id">#${entry.messageId}</span>
            <span class="roulette-history-profile">${escapeHtml(entry.profileName ?? '?')}</span>
            <span class="roulette-history-time">${formatTime(entry.timestamp)}</span>
        `;
        listEl.appendChild(row);
    }
    if (history.length > LIST_CAP) {
        const note = document.createElement('div');
        note.className = 'roulette-history-truncation';
        note.textContent = `Showing newest ${LIST_CAP} of ${history.length}.`;
        listEl.appendChild(note);
    }
}

function formatTime(ts) {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
