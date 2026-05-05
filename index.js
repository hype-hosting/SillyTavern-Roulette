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

import { eventSource, event_types } from '../../../../script.js';

const EXT_NAME = 'Roulette';

function onMessageReceived(messageId, type) {
    console.debug(`[${EXT_NAME}] MESSAGE_RECEIVED id=${messageId} type=${type ?? 'normal'}`);
}

function onGenerationStarted(type, _options, dryRun) {
    console.debug(`[${EXT_NAME}] GENERATION_STARTED type=${type ?? 'normal'} dryRun=${!!dryRun}`);
}

function onMessageSwiped(messageId) {
    console.debug(`[${EXT_NAME}] MESSAGE_SWIPED id=${messageId}`);
}

function onChatChanged(chatId) {
    console.debug(`[${EXT_NAME}] CHAT_CHANGED id=${chatId}`);
}

function onConnectionProfileLoaded(profileName) {
    console.debug(`[${EXT_NAME}] CONNECTION_PROFILE_LOADED name=${profileName}`);
}

function registerEventListeners() {
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageSwiped);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onConnectionProfileLoaded);
}

function registerSlashCommands() {
    // TODO: register /roulette-start, /roulette-stop, /roulette-status, /roulette-skip
    //       via SlashCommandParser.addCommandObject(SlashCommand.fromProps({...})).
    console.debug(`[${EXT_NAME}] slash command registration stub`);
}

export async function init() {
    console.log(`[${EXT_NAME}] init() called`);
    registerEventListeners();
    registerSlashCommands();
}
