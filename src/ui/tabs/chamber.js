/* SillyTavern-Roulette — AGPL-3.0
 * Chamber tab — cylinder visualization + status + action buttons.
 * Step 1 placeholder; cylinder + wiring lands in steps 2-5.
 */

export function mountChamberTab(container) {
    container.innerHTML = `
        <div class="roulette-tab-placeholder">
            <i class="fa-solid fa-circle-dot"></i>
            <p>Chamber view — cylinder coming next.</p>
        </div>
    `;
}

export function refreshChamberTab(_container) {
    // no-op for step 1
}
