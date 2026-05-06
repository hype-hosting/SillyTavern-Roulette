/* SillyTavern-Roulette — AGPL-3.0
 * History tab — trail strip + per-pick rows. Step 8 build target.
 */

export function mountHistoryTab(container) {
    container.innerHTML = `
        <div class="roulette-tab-placeholder">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <p>History view — coming in step 8.</p>
        </div>
    `;
}

export function refreshHistoryTab(_container) {
    // no-op for step 1
}
