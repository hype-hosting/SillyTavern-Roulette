/* SillyTavern-Roulette — AGPL-3.0
 *
 * Themed confirmation dialog on ST's Popup class. Replaces native
 * confirm(), which is unthemed browser chrome, blocks the main thread, and
 * may be suppressed by browsers after repeated dialogs.
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../scripts/popup.js';

/**
 * Ask the user a yes/no question.
 *
 * @param {string} message plain text (rendered via textContent — never HTML)
 * @param {{okButton?: string, cancelButton?: string}} [options]
 * @returns {Promise<boolean>} true iff the user confirmed
 */
export async function confirmDialog(message, { okButton = 'OK', cancelButton = 'Cancel' } = {}) {
    const content = document.createElement('div');
    content.className = 'roulette-extension roulette-confirm';
    content.textContent = message;
    const result = await new Popup(content, POPUP_TYPE.CONFIRM, '', { okButton, cancelButton }).show();
    return result === POPUP_RESULT.AFFIRMATIVE;
}
