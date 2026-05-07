/* SillyTavern-Roulette — AGPL-3.0
 *
 * Floating widget — a draggable, persistent on-screen visualisation of
 * the active rotation. Lives in `position: fixed`, mounted to <body>.
 *
 *  - Toggleable. State persists in extension_settings.roulette.ui.widget.
 *  - Auto-hides while the modal is open (the modal already shows a bigger
 *    cylinder; no point duplicating).
 *  - Desktop only — mounting is gated by viewport width at init time.
 *  - Two visual modes: expanded (~220px panel with cylinder + status +
 *    history dropdown) and collapsed (~40px dice-icon dot, draggable).
 *
 * Drag uses Pointer Events for unified mouse/trackpad input. Position is
 * clamped within the viewport on drop, on window resize, and at mount.
 *
 * The cylinder rendering and spin animation are reused verbatim from
 * src/ui/cylinder.js — same SVG component the modal uses, just sized
 * smaller via the `mini` variant.
 */

import { findQueue, getChatState, getSettings, persistSettings } from '../state.js';
import { onRotationStateChanged } from '../events.js';
import { renderCylinder, spinCylinderTo, rotationForActiveIndex } from './cylinder.js';
import { colorForProfile } from './profileColors.js';
import { openRouletteModal, isModalOpen } from './modal.js';

const WIDGET_WIDTH_EXPANDED = 240;
const WIDGET_HEIGHT_COLLAPSED = 44;
const EDGE_MARGIN = 12; // keep this far from any viewport edge
const HISTORY_CAP = 12;
const DESKTOP_MIN_WIDTH = 720;

let widgetEl = null;
let unsubscribeStateChange = null;
let resizeListener = null;
let modalOpenObserver = null;
let lastActiveSlotId = null;
let lastQueueId = null;

/**
 * Mount the widget if user has it enabled in settings AND we're on desktop.
 * Idempotent — calling repeatedly is safe.
 */
export function mountWidget() {
    const ui = getSettings().ui;
    if (!ui?.widget?.enabled) return;
    if (window.innerWidth < DESKTOP_MIN_WIDTH) return;
    if (widgetEl) return;
    build();
    show();
}

/**
 * Unmount the widget (e.g. when user toggles off in settings).
 */
export function unmountWidget() {
    if (!widgetEl) return;
    widgetEl.remove();
    widgetEl = null;
    if (unsubscribeStateChange) {
        unsubscribeStateChange();
        unsubscribeStateChange = null;
    }
    if (resizeListener) {
        window.removeEventListener('resize', resizeListener);
        resizeListener = null;
    }
    if (modalOpenObserver) {
        clearInterval(modalOpenObserver);
        modalOpenObserver = null;
    }
    lastActiveSlotId = null;
    lastQueueId = null;
}

/**
 * Toggle widget on/off; persists. Used by the drawer + Settings tab.
 */
export function setWidgetEnabled(enabled) {
    const ui = getSettings().ui;
    ui.widget.enabled = !!enabled;
    persistSettings();
    if (enabled) {
        mountWidget();
    } else {
        unmountWidget();
    }
}

/**
 * Reset the widget's stored position so it returns to the default corner.
 */
export function resetWidgetPosition() {
    const ui = getSettings().ui;
    ui.widget.x = null;
    ui.widget.y = null;
    persistSettings();
    if (widgetEl) {
        positionAtDefault();
    }
}

function build() {
    const ui = getSettings().ui;
    widgetEl = document.createElement('div');
    widgetEl.className = 'roulette-extension roulette-widget';
    widgetEl.setAttribute('role', 'complementary');
    widgetEl.setAttribute('aria-label', 'Roulette rotation status');

    if (ui.widget.collapsed) widgetEl.classList.add('roulette-widget-collapsed');

    widgetEl.innerHTML = `
        <div class="roulette-widget-handle" data-field="handle">
            <div class="roulette-widget-grip" aria-hidden="true">
                <i class="fa-solid fa-grip-vertical"></i>
            </div>
            <div class="roulette-widget-title">Roulette</div>
            <div class="roulette-widget-actions">
                <button type="button" class="roulette-widget-btn" data-action="collapse" aria-label="Collapse">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <button type="button" class="roulette-widget-btn" data-action="hide" aria-label="Hide widget">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="roulette-widget-collapsed-icon" aria-hidden="true">
                <i class="fa-solid fa-circle-dot"></i>
            </div>
        </div>
        <div class="roulette-widget-body" data-field="body">
            <div class="roulette-widget-cylinder" data-field="cylinder-host"></div>
            <div class="roulette-widget-status" data-field="status"></div>
            <button type="button" class="roulette-widget-history-toggle" data-action="toggle-history">
                <span class="roulette-section-title">Recent picks</span>
                <i class="fa-solid fa-chevron-down roulette-widget-chevron" data-field="chevron"></i>
            </button>
            <div class="roulette-widget-history" data-field="history"></div>
        </div>
    `;

    document.body.appendChild(widgetEl);
    positionAtStored();
    if (ui.widget.historyOpen) widgetEl.classList.add('roulette-widget-history-open');

    wireDrag();
    wireActions();
    wireSubscriptions();
    render();
}

function show() {
    // Initial visibility: respects modal-open state too.
    refreshVisibility();
}

function positionAtStored() {
    const ui = getSettings().ui;
    if (ui.widget.x != null && ui.widget.y != null) {
        moveTo(ui.widget.x, ui.widget.y, /*persist=*/false);
    } else {
        positionAtDefault();
    }
}

function positionAtDefault() {
    // Bottom-right corner with comfortable margin. We use the actual
    // rendered dimensions if available; the assumed size only applies
    // on first paint before layout has measured the element.
    const w = widgetEl.offsetWidth || WIDGET_WIDTH_EXPANDED;
    const h = widgetEl.offsetHeight || 360;
    const x = window.innerWidth - w - EDGE_MARGIN;
    const y = window.innerHeight - h - EDGE_MARGIN;
    moveTo(x, y, /*persist=*/false);
}

function moveTo(x, y, persist = true) {
    if (!widgetEl) return;
    const w = widgetEl.offsetWidth || WIDGET_WIDTH_EXPANDED;
    const h = widgetEl.offsetHeight || WIDGET_HEIGHT_COLLAPSED;
    const clampedX = Math.max(EDGE_MARGIN, Math.min(window.innerWidth - w - EDGE_MARGIN, x));
    const clampedY = Math.max(EDGE_MARGIN, Math.min(window.innerHeight - h - EDGE_MARGIN, y));
    widgetEl.style.left = `${clampedX}px`;
    widgetEl.style.top = `${clampedY}px`;
    if (persist) {
        const ui = getSettings().ui;
        ui.widget.x = clampedX;
        ui.widget.y = clampedY;
        persistSettings();
    }
}

function wireDrag() {
    const handle = widgetEl.querySelector('[data-field="handle"]');
    let dragState = null;

    handle.addEventListener('pointerdown', (e) => {
        // Don't initiate drag on the action buttons.
        if (e.target.closest('button')) return;
        const rect = widgetEl.getBoundingClientRect();
        dragState = {
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
            pointerId: e.pointerId,
        };
        try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        // Only treat the gesture as a drag once the pointer crosses a
        // small threshold — keeps a tap-and-release on the collapsed dot
        // from being misread as a zero-length drag (which suppresses the
        // native click event on pointer-captured elements).
        if (!dragState.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            dragState.moved = true;
            widgetEl.classList.add('roulette-widget-dragging');
        }
        if (dragState.moved) {
            const x = e.clientX - dragState.offsetX;
            const y = e.clientY - dragState.offsetY;
            moveTo(x, y, /*persist=*/false);
        }
    });

    const endDrag = (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const wasDrag = dragState.moved;
        const target = e.target;
        if (wasDrag) {
            const rect = widgetEl.getBoundingClientRect();
            moveTo(rect.left, rect.top, /*persist=*/true);
        }
        widgetEl.classList.remove('roulette-widget-dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        dragState = null;

        // Tap (not drag): if the widget is collapsed, expand it. Pointer
        // capture suppresses the would-be native click on the icon, so we
        // synthesise the click behaviour here. Skip if the tap landed on
        // an action button — those have their own handlers.
        if (!wasDrag && !target?.closest?.('button')
            && widgetEl.classList.contains('roulette-widget-collapsed')) {
            toggleCollapsed();
        }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    // Re-clamp on viewport resize so the widget doesn't strand off-screen.
    resizeListener = () => {
        if (!widgetEl) return;
        const r = widgetEl.getBoundingClientRect();
        moveTo(r.left, r.top, /*persist=*/false);
    };
    window.addEventListener('resize', resizeListener);
}

function wireActions() {
    widgetEl.querySelector('[data-action="collapse"]').addEventListener('click', toggleCollapsed);
    widgetEl.querySelector('[data-action="hide"]').addEventListener('click', () => setWidgetEnabled(false));
    widgetEl.querySelector('[data-action="toggle-history"]').addEventListener('click', toggleHistory);

    // Click on the cylinder area in expanded mode opens the modal at the
    // Chamber tab. (The collapsed-state expand-on-click is handled in
    // wireDrag's endDrag — pointer capture would suppress the native
    // click here.)
    widgetEl.querySelector('[data-field="cylinder-host"]').addEventListener('click', () => {
        if (widgetEl.classList.contains('roulette-widget-collapsed')) return;
        openRouletteModal('chamber');
    });
}

function toggleCollapsed() {
    if (!widgetEl) return;
    const ui = getSettings().ui;
    ui.widget.collapsed = !ui.widget.collapsed;
    persistSettings();
    widgetEl.classList.toggle('roulette-widget-collapsed', ui.widget.collapsed);
    // Re-clamp position because the widget's footprint just changed.
    requestAnimationFrame(() => {
        const r = widgetEl.getBoundingClientRect();
        moveTo(r.left, r.top, /*persist=*/false);
    });
}

function toggleHistory() {
    if (!widgetEl) return;
    const ui = getSettings().ui;
    ui.widget.historyOpen = !ui.widget.historyOpen;
    persistSettings();
    widgetEl.classList.toggle('roulette-widget-history-open', ui.widget.historyOpen);
    requestAnimationFrame(() => {
        const r = widgetEl.getBoundingClientRect();
        moveTo(r.left, r.top, /*persist=*/false);
    });
}

function wireSubscriptions() {
    unsubscribeStateChange = onRotationStateChanged(render);

    // Modal-open observer. The modal sets/unsets a global popup; we poll
    // because the modal subsystem doesn't currently emit a "modal opened"
    // event. Cheap (200ms tick).
    let lastModalOpen = false;
    modalOpenObserver = setInterval(() => {
        const open = isModalOpen();
        if (open !== lastModalOpen) {
            lastModalOpen = open;
            refreshVisibility();
        }
    }, 200);
}

function refreshVisibility() {
    if (!widgetEl) return;
    const hide = isModalOpen();
    widgetEl.classList.toggle('roulette-widget-hidden', hide);
}

function render() {
    if (!widgetEl) return;
    const state = getChatState();
    const queue = state.activeQueueId ? findQueue(state.activeQueueId) : null;
    const settings = getSettings();
    const previewQueue = queue ?? settings.queues[0] ?? null;
    const activeSlotId = queue ? state.currentSlotId : null;

    renderCylinderArea(previewQueue, activeSlotId, state);
    renderStatus(queue, previewQueue, state);
    renderHistory(state);
}

function renderCylinderArea(previewQueue, activeSlotId, state) {
    const host = widgetEl.querySelector('[data-field="cylinder-host"]');
    if (!host) return;

    if (!previewQueue) {
        host.innerHTML = '<div class="roulette-widget-empty">No queue</div>';
        lastQueueId = null;
        lastActiveSlotId = null;
        return;
    }

    const existing = host.querySelector('.roulette-cylinder');
    const queueChanged = previewQueue.id !== lastQueueId;
    const needsFullRender = !existing || queueChanged;

    if (needsFullRender) {
        host.innerHTML = '';
        const startIdx = activeSlotId
            ? previewQueue.slots.findIndex(s => s.id === activeSlotId)
            : -1;
        const initialAngle = rotationForActiveIndex(startIdx, previewQueue.slots.length);
        const svg = renderCylinder({
            slots: previewQueue.slots ?? [],
            activeSlotId,
            mode: previewQueue.mode,
            mini: true,
            initialAngle,
            responsesRemaining: state.responsesRemaining,
            responsesAllotted: state.responsesAllotted,
        });
        host.appendChild(svg);
        lastQueueId = previewQueue.id;
        lastActiveSlotId = activeSlotId;
    } else if (activeSlotId !== lastActiveSlotId) {
        const newIdx = previewQueue.slots.findIndex(s => s.id === activeSlotId);
        const N = previewQueue.slots.length;
        spinCylinderTo(existing, newIdx, N, previewQueue.mode).then(() => {
            // After spin settles, re-render so the active visuals (halo,
            // pip ring) move to the newly-resting chamber. Same pattern
            // the modal Chamber tab uses.
            const finalAngle = rotationForActiveIndex(newIdx, N);
            host.innerHTML = '';
            const newSvg = renderCylinder({
                slots: previewQueue.slots,
                activeSlotId,
                mode: previewQueue.mode,
                mini: true,
                initialAngle: finalAngle,
                responsesRemaining: state.responsesRemaining,
                responsesAllotted: state.responsesAllotted,
            });
            host.appendChild(newSvg);
        });
        lastActiveSlotId = activeSlotId;
    }
}

function renderStatus(queue, previewQueue, state) {
    const el = widgetEl.querySelector('[data-field="status"]');
    if (!el) return;

    if (queue) {
        const slot = queue.slots.find(s => s.id === state.currentSlotId);
        const profile = slot?.profileName ?? '?';
        const left = state.responsesRemaining;
        const profileColor = colorForProfile(profile) ?? 'var(--roulette-text-dim)';
        el.innerHTML = `
            <span class="roulette-widget-status-dot" style="background:${profileColor}"></span>
            <span class="roulette-widget-status-name" title="${escapeHtml(profile)}">${escapeHtml(profile)}</span>
            <span class="roulette-widget-status-counter">${left} left</span>
            ${state.manuallyOverridden ? '<span class="roulette-widget-status-paused">paused</span>' : ''}
        `;
    } else if (previewQueue) {
        el.innerHTML = `<span class="roulette-widget-status-idle">${escapeHtml(previewQueue.name)} · idle</span>`;
    } else {
        el.innerHTML = '<span class="roulette-widget-status-idle">No active queue</span>';
    }
}

function renderHistory(state) {
    const el = widgetEl.querySelector('[data-field="history"]');
    if (!el) return;

    const history = Array.isArray(state.history) ? state.history : [];
    if (history.length === 0) {
        el.innerHTML = '<div class="roulette-widget-history-empty">No picks yet.</div>';
        return;
    }

    const recent = history.slice(-HISTORY_CAP).reverse();
    el.innerHTML = recent.map(entry => {
        const c = colorForProfile(entry.profileName) ?? 'var(--roulette-text-dim)';
        return `<div class="roulette-widget-history-row">
            <span class="roulette-widget-history-dot" style="background:${c}"></span>
            <span class="roulette-widget-history-id">#${entry.messageId}</span>
            <span class="roulette-widget-history-profile">${escapeHtml(entry.profileName ?? '?')}</span>
            <span class="roulette-widget-history-time">${formatRelativeTime(entry.timestamp)}</span>
        </div>`;
    }).join('');
}

function formatRelativeTime(ts) {
    if (!Number.isFinite(ts)) return '';
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
