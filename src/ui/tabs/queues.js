/* SillyTavern-Roulette — AGPL-3.0
 * Queues tab — card grid + inline editor. Step 6/7 build target.
 */

export function mountQueuesTab(container) {
    container.innerHTML = `
        <div class="roulette-tab-placeholder">
            <i class="fa-solid fa-layer-group"></i>
            <p>Queue management — card grid coming in step 6.</p>
        </div>
    `;
}

export function refreshQueuesTab(_container) {
    // no-op for step 1
}
