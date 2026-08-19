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
import { mountBar } from './src/ui/bar.js';
import { getSettings, applyUiSettings } from './src/state.js';

const EXT_NAME = 'Roulette';

let initialized = false;

export async function init() {
    // Both the manifest hook and the self-invoke below call init(); the
    // second call is a silent no-op.
    if (initialized) return;
    initialized = true;
    try {
        getSettings();
        applyUiSettings();
        registerEventListeners();
        registerSlashCommands();
        mountSettingsPanel();
        mountBar();
        console.log(`[${EXT_NAME}] init() complete`);
    } catch (err) {
        initialized = false; // allow retry
        console.error(`[${EXT_NAME}] init() failed:`, err);
        if (typeof toastr !== 'undefined') {
            toastr.error(`Roulette init failed: ${err?.message ?? err}`);
        }
        throw err;
    }
}

// Self-invoke as a fallback. ST's hooks.activate convention is supposed to
// call init() for us, but in practice that path is silent-failing for some
// installs. Top-level init is safe because every register/mount is guarded
// by an idempotent flag.
Promise.resolve().then(() => {
    init().catch(err => console.error(`[${EXT_NAME}] self-init failed:`, err));
});
