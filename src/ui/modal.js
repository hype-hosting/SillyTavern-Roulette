/* SillyTavern-Roulette — AGPL-3.0
 *
 * Modal chassis. Tabbed full-screen modal owned by ST's Popup class so we
 * inherit z-index, focus trap, and ESC-to-close. Tab content is rendered
 * by separate modules under src/ui/tabs/. Open state is global; switching
 * chats does not close it.
 *
 * Public API:
 *   openRouletteModal(tab?)   — open (optionally jump to a tab)
 *   closeRouletteModal()      — close (no-op if not open)
 *   isModalOpen()             — boolean
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../scripts/popup.js';
import { mountChamberTab, refreshChamberTab } from './tabs/chamber.js';
import { mountQueuesTab, refreshQueuesTab } from './tabs/queues.js';
import { mountHistoryTab, refreshHistoryTab } from './tabs/history.js';
import { mountSettingsTab, refreshSettingsTab } from './tabs/settings.js';
import { onRotationStateChanged } from '../events.js';

const TABS = [
    { id: 'chamber',  label: 'Chamber',  icon: 'fa-circle-dot',     mount: mountChamberTab,  refresh: refreshChamberTab },
    { id: 'queues',   label: 'Queues',   icon: 'fa-layer-group',    mount: mountQueuesTab,   refresh: refreshQueuesTab },
    { id: 'history',  label: 'History',  icon: 'fa-clock-rotate-left', mount: mountHistoryTab, refresh: refreshHistoryTab },
    { id: 'settings', label: 'Settings', icon: 'fa-sliders',        mount: mountSettingsTab, refresh: refreshSettingsTab },
];

let popup = null;
let rootEl = null;
let activeTab = 'chamber';
const tabPanels = new Map();
let unsubscribeStateChange = null;

export function isModalOpen() {
    return !!popup;
}

export async function openRouletteModal(tabId = null) {
    if (popup) {
        if (tabId) selectTab(tabId);
        return;
    }
    rootEl = document.createElement('div');
    rootEl.className = 'roulette-extension roulette-modal';
    rootEl.innerHTML = template();
    buildTabRail();
    buildTabPanels();
    if (tabId) activeTab = tabId;
    selectTab(activeTab);

    // Our own close button — ST's popup chrome ✕ is unreliable on narrow
    // viewports (positioned outside the popup bounds on iOS). Owning it
    // here means the modal is always closeable.
    rootEl.querySelector('[data-action="close"]').addEventListener('click', closeRouletteModal);

    popup = new Popup(rootEl, POPUP_TYPE.DISPLAY, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        leftAlign: true,
        customButtons: [],
        onClosing: () => {
            if (unsubscribeStateChange) {
                unsubscribeStateChange();
                unsubscribeStateChange = null;
            }
            popup = null;
            rootEl = null;
            tabPanels.clear();
            return true;
        },
    });

    unsubscribeStateChange = onRotationStateChanged(() => {
        const t = TABS.find(t => t.id === activeTab);
        if (t && rootEl) t.refresh(tabPanels.get(activeTab));
    });

    await popup.show();
}

export function closeRouletteModal() {
    if (!popup) return;
    popup.completeAffirmative();
}

function buildTabRail() {
    const rail = rootEl.querySelector('[data-field="tab-rail"]');
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-orientation', 'vertical');
    rail.innerHTML = '';
    for (const tab of TABS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'roulette-tab';
        item.dataset.tabId = tab.id;
        item.setAttribute('role', 'tab');
        item.setAttribute('aria-controls', `roulette-tab-panel-${tab.id}`);
        item.id = `roulette-tab-${tab.id}`;
        item.innerHTML = `<i class="fa-solid ${tab.icon}"></i><span>${tab.label}</span>`;
        item.addEventListener('click', () => selectTab(tab.id));
        item.addEventListener('keydown', (e) => onTabKeydown(e, tab.id));
        rail.appendChild(item);
    }
}

function onTabKeydown(e, currentTabId) {
    const idx = TABS.findIndex(t => t.id === currentTabId);
    if (idx < 0) return;
    let nextIdx = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIdx = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TABS.length - 1;
    if (nextIdx < 0) return;
    e.preventDefault();
    selectTab(TABS[nextIdx].id);
    rootEl.querySelector(`[data-tab-id="${TABS[nextIdx].id}"]`)?.focus();
}

function buildTabPanels() {
    const host = rootEl.querySelector('[data-field="tab-panels"]');
    host.innerHTML = '';
    for (const tab of TABS) {
        const panel = document.createElement('div');
        panel.className = 'roulette-tab-panel hidden';
        panel.dataset.tabId = tab.id;
        panel.id = `roulette-tab-panel-${tab.id}`;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', `roulette-tab-${tab.id}`);
        host.appendChild(panel);
        tabPanels.set(tab.id, panel);
        try {
            tab.mount(panel);
        } catch (err) {
            console.error(`[Roulette] mount ${tab.id} failed:`, err);
            panel.innerHTML = `<div class="roulette-empty">Tab "${tab.label}" failed to render.</div>`;
        }
    }
}

function selectTab(tabId) {
    const valid = TABS.find(t => t.id === tabId);
    if (!valid) return;
    activeTab = tabId;

    rootEl.querySelectorAll('.roulette-tab').forEach(el => {
        const isActive = el.dataset.tabId === tabId;
        el.classList.toggle('roulette-tab-active', isActive);
        el.setAttribute('aria-selected', String(isActive));
        el.tabIndex = isActive ? 0 : -1;
    });
    rootEl.querySelectorAll('.roulette-tab-panel').forEach(el => {
        el.classList.toggle('hidden', el.dataset.tabId !== tabId);
    });

    const panel = tabPanels.get(tabId);
    if (panel) {
        try { valid.refresh(panel); }
        catch (err) { console.error(`[Roulette] refresh ${tabId} failed:`, err); }
    }
}

function template() {
    return `
        <div class="roulette-modal-shell">
            <div class="roulette-modal-header">
                <div class="roulette-modal-title">
                    <i class="fa-solid fa-circle-dot roulette-modal-glyph"></i>
                    <span>Roulette</span>
                </div>
                <button type="button" class="roulette-modal-close" data-action="close" aria-label="Close Roulette">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="roulette-modal-body">
                <nav class="roulette-tab-rail" data-field="tab-rail"></nav>
                <section class="roulette-tab-content" data-field="tab-panels"></section>
            </div>
        </div>
    `;
}
