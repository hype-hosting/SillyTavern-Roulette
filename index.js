/*
 * SillyTavern-Roulette — rotate between connection profiles during roleplay.
 * Copyright (C) 2026 Hyperion Blackthorne
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details. <https://www.gnu.org/licenses/agpl-3.0.html>
 */

import { registerEventListeners } from './src/events.js';
import { registerSlashCommands } from './src/slashCommands.js';
import { mountSettingsPanel } from './src/ui/settingsPanel.js';
import { mountStatusIndicator } from './src/ui/statusIndicator.js';
import { getSettings } from './src/state.js';

const EXT_NAME = 'Roulette';

console.log(`[${EXT_NAME}] module loaded`);

export async function init() {
    console.log(`[${EXT_NAME}] init() called`);
    try {
        getSettings();
        registerEventListeners();
        console.log(`[${EXT_NAME}] event listeners registered`);
        registerSlashCommands();
        console.log(`[${EXT_NAME}] slash commands registered`);
        mountSettingsPanel();
        console.log(`[${EXT_NAME}] settings panel mounted`);
        mountStatusIndicator();
        console.log(`[${EXT_NAME}] status indicator mounted`);
        console.log(`[${EXT_NAME}] init() complete`);
    } catch (err) {
        console.error(`[${EXT_NAME}] init() failed:`, err);
        if (typeof toastr !== 'undefined') {
            toastr.error(`Roulette init failed: ${err?.message ?? err}`);
        }
        throw err;
    }
}
