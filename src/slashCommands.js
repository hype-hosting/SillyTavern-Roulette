/* SillyTavern-Roulette — AGPL-3.0
 *
 *   /roulette-start <queueName>   activate a queue on the current chat
 *   /roulette-stop                deactivate rotation
 *   /roulette-status              print current rotation state as a system msg
 *   /roulette-skip                force-advance to the next slot
 *   /roulette-bind <queueName>    auto-start a queue for the current character
 *   /roulette-unbind              remove the current character's binding
 */

import { SlashCommandParser } from '../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../scripts/slash-commands/SlashCommand.js';
import {
    SlashCommandArgument,
    ARGUMENT_TYPE,
} from '../../../../../scripts/slash-commands/SlashCommandArgument.js';
import { sendSystemMessage, system_message_types } from '../../../../../scripts/system-messages.js';
import { getSettings, findQueue, getChatState } from './state.js';
import { startRotation, stopRotation, skipCurrentSlot, reevaluateAutoActivation } from './events.js';
import {
    getCurrentCharacter,
    getBoundQueueId,
    setBinding,
    clearBinding,
    isGroupChat,
} from './characterBinding.js';

function findQueueByName(name) {
    if (!name) return null;
    const queues = getSettings().queues;
    return queues.find(q => q.name === name)
        ?? queues.find(q => q.name.toLowerCase() === name.toLowerCase())
        ?? null;
}

function queueNameProvider() {
    return getSettings().queues.map(q => ({
        value: q.name,
        description: `${q.mode} · ${q.slots?.length ?? 0} slot(s)`,
    }));
}

let registered = false;

export function registerSlashCommands() {
    if (registered) return;
    registered = true;

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roulette-start',
        helpString: 'Start rotation on the current chat using the named queue.',
        returns: 'name of the queue that was started, or empty on failure',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Queue name (as defined in Roulette settings)',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
                enumProvider: queueNameProvider,
            }),
        ],
        callback: async (_args, value) => {
            const name = String(value ?? '').trim();
            const queue = findQueueByName(name);
            if (!queue) {
                if (typeof toastr !== 'undefined') toastr.error(`Roulette: queue "${name}" not found.`);
                return '';
            }
            const result = await startRotation(queue.id);
            if (!result.ok) {
                if (typeof toastr !== 'undefined') toastr.error(`Roulette: ${result.error}`);
                return '';
            }
            return queue.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roulette-stop',
        helpString: 'Stop Roulette rotation on the current chat.',
        returns: 'empty string',
        callback: async () => {
            stopRotation();
            return '';
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roulette-status',
        helpString: 'Print current Roulette rotation state.',
        returns: 'human-readable status line',
        callback: async () => {
            const state = getChatState();
            let status;
            if (!state.activeQueueId) {
                status = 'Roulette: off';
            } else {
                const queue = findQueue(state.activeQueueId);
                if (!queue) {
                    status = 'Roulette: active queue missing';
                } else {
                    const slot = queue.slots.find(s => s.id === state.currentSlotId);
                    const profile = slot?.profileName ?? '?';
                    const remaining = state.responsesRemaining;
                    const flag = state.manuallyOverridden ? ' (paused: manual override)' : '';
                    status = `Roulette: ${queue.name} · ${profile} · ${remaining} left${flag}`;
                }
            }
            // Typed bare in the chat input, a command's return value is never
            // displayed — ST discards the pipe. Emit a system message so the
            // user actually sees something; the return stays for piping
            // (e.g. `/roulette-status | /echo {{pipe}}`).
            sendSystemMessage(system_message_types.GENERIC, status);
            return status;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roulette-skip',
        helpString: 'Force-advance Roulette to the next slot immediately.',
        returns: 'name of the new profile, or empty on failure',
        callback: async () => {
            const result = await skipCurrentSlot();
            if (!result.ok) {
                if (typeof toastr !== 'undefined') toastr.warning(`Roulette: ${result.error}`);
                return '';
            }
            const state = getChatState();
            const queue = findQueue(state.activeQueueId);
            const slot = queue?.slots.find(s => s.id === state.currentSlotId);
            return slot?.profileName ?? '';
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roulette-bind',
        helpString: 'Bind the current character to a queue, so opening their chats '
            + 'starts that queue automatically. Not available in group chats.',
        returns: 'name of the bound queue, or empty on failure',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Queue name (as defined in Roulette settings)',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
                enumProvider: queueNameProvider,
            }),
        ],
        callback: async (_args, value) => {
            const character = getCurrentCharacter();
            if (!character) {
                const why = isGroupChat()
                    ? 'bindings do not apply to group chats'
                    : 'no character is loaded';
                if (typeof toastr !== 'undefined') toastr.warning(`Roulette: ${why}.`);
                return '';
            }
            const name = String(value ?? '').trim();
            const queue = findQueueByName(name);
            if (!queue) {
                if (typeof toastr !== 'undefined') toastr.error(`Roulette: queue "${name}" not found.`);
                return '';
            }
            setBinding(character.key, queue.id);
            // Take effect in the chat we're already in, not just future loads.
            await reevaluateAutoActivation();
            return queue.name;
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roulette-unbind',
        helpString: 'Remove the current character\'s queue binding. Any rotation '
            + 'already running in this chat keeps going.',
        returns: 'name of the queue that was unbound, or empty if there was none',
        callback: async () => {
            const character = getCurrentCharacter();
            if (!character) {
                const why = isGroupChat()
                    ? 'bindings do not apply to group chats'
                    : 'no character is loaded';
                if (typeof toastr !== 'undefined') toastr.warning(`Roulette: ${why}.`);
                return '';
            }
            const previous = findQueue(getBoundQueueId(character.key));
            if (!clearBinding(character.key)) return '';
            return previous?.name ?? '';
        },
    }));
}
