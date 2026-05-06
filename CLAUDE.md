# SillyTavern Roulette

A SillyTavern extension that rotates between connection profiles during roleplay — sequentially or by weighted random — so the user can mix models, parameters, and providers throughout a chat without manually switching.

**License:** AGPL-3.0 (matches SillyTavern)
**Target:** SillyTavern 1.12+ (uses Connection Manager / connection profiles API)
**Repo name:** `SillyTavern-Roulette`
**Extension display name:** `Roulette`

---

## Concept

Users select multiple SillyTavern connection profiles, drop them into a "queue," set a rotation policy (sequential with fixed or ranged response counts, or weighted-random), and the extension automatically switches the active connection profile as the chat proceeds. State is per-chat. A small status indicator surfaces the current profile and how many responses remain in the current slot.

Because the unit of rotation is the **connection profile**, the extension does not need to know anything about individual providers, API endpoints, model names, or sampler parameters — all of that lives in the profile itself. The extension is a *scheduler* that calls the existing profile-switch slash command at the right moments.

---

## Architecture overview

### Core principle
The extension is a thin scheduler layered on top of SillyTavern's existing Connection Manager. It does not reimplement provider switching, parameter handling, or model selection. It listens to chat events, decides when to advance the rotation, and triggers `/profile <name>` to switch.

### Hook points (SillyTavern event system)
Use `eventSource.on(event_types.X, handler)` for all of these. Import `eventSource` and `event_types` from `../../../../script.js` (verified — see "Verified ST internals" below).

- `MESSAGE_RECEIVED` — primary trigger for advancing the response counter. **Emitted with `(messageId, type)`** where `type` is one of `'swipe'`, `'continue'`, `'append'`, `'appendFinal'`, `'regenerate'`, `'impersonate'`, `'quiet'`, `'first_message'`, or `undefined` for a normal generation. **Advance the counter only when `type` is undefined/normal.** Filtering on `type` is what makes swipes, regens, continues, and impersonations not consume rotation slots — there is no other event-level guard.
- `GENERATION_STARTED` — emitted with `(type, options, dryRun)`. The moment to fire the profile switch *before* the next generation, if the rotation says it's time to switch. **Skip when `dryRun === true`** (ST emits this for prompt-token-counting and similar dry runs) and skip non-normal `type` values (same set as above). This is critical: we switch profiles *before* the model generates, not after.
- `MESSAGE_SWIPED` — fires when the user navigates between **existing** swipes via the left/right arrows; not on swipe-regeneration. Largely irrelevant to the scheduler since the `type` filter on `MESSAGE_RECEIVED`/`GENERATION_STARTED` already handles regen-swipes.
- `CHAT_CHANGED` — emitted as `'chat_id_changed'`. Reload per-chat rotation state when the user switches chats.
- `CONNECTION_PROFILE_LOADED` — fires for **both** manual user switches *and* our own programmatic `/profile` calls (verified: see "Verified ST internals"). The handler must consult an internal `isInternalSwitch` flag we set immediately before firing `/profile` and clear inside the handler — otherwise we trip our own manual-override path on every rotation.

**Generation type strings** (for the filter logic in `rotation.js`):
- Advance counter / fire switch: `undefined` (normal user generation).
- Ignore: `'swipe'`, `'regenerate'`, `'continue'`, `'append'`, `'appendFinal'`, `'impersonate'`, `'quiet'`, `'first_message'`, plus any `dryRun === true`.

### Profile switching mechanism
Use SillyTavern's slash command system to switch profiles. The `/profile` command is registered by the built-in Connection Profiles extension and accepts an `await=true` named arg that resolves only after `CONNECTION_PROFILE_LOADED` and an online-status check — use it so the switch is synchronous from our perspective:

```js
import { executeSlashCommandsWithOptions } from '../../../../scripts/slash-commands.js';
// Set isInternalSwitch = true here, then:
await executeSlashCommandsWithOptions(`/profile await=true ${profileName}`, { showOutput: false });
// CONNECTION_PROFILE_LOADED handler will fire during this await; it must check the flag and bail.
```

`/profile` does fuzzy matching by name via Fuse.js, so an exact-name validation pass against `extension_settings.connectionManager.profiles` is required *before* firing — otherwise a typo'd slot may silently switch to an unrelated profile.

### State storage
- **Global settings** (rotation queues the user has defined, default rotation, UI preferences) → `extension_settings.roulette` (persisted via `saveSettingsDebounced()`).
- **Per-chat rotation state** (which queue is active, current slot index, responses remaining in current slot, history of which profile generated which message) → `chat_metadata.roulette` (persisted via `saveMetadataDebounced()` from `../../../../scripts/extensions.js`).

This split is deliberate: queue *definitions* are user-level assets reused across chats; *active rotation state* is chat-specific so different stories can run different rotations independently.

---

## Feature spec — MVP

### 1. Queue definition

A **Queue** is a named, ordered list of **Slots**. Each slot references one connection profile and carries scheduling info.

```ts
type Slot = {
  id: string;              // uuid
  profileName: string;     // exact name of an existing ST connection profile
  // For sequential mode:
  countMode: 'fixed' | 'range';
  fixedCount?: number;     // used when countMode === 'fixed'
  minCount?: number;       // used when countMode === 'range'
  maxCount?: number;       // used when countMode === 'range'
  // For weighted-random mode:
  weight?: number;         // relative weight, default 1
};

type Queue = {
  id: string;              // uuid
  name: string;            // user-facing label
  mode: 'sequential' | 'weighted-random';
  slots: Slot[];
  // Weighted-random options:
  noRepeatInRow?: boolean; // if true, never pick the same profile twice consecutively
  weightedRunCount?: { mode: 'fixed' | 'range'; fixed?: number; min?: number; max?: number };
  // ^ how many responses each randomly-picked profile runs for before re-rolling
};
```

### 2. Rotation modes

**Sequential**
- Walks `slots` in order, looping back to the start after the last slot.
- For each slot, runs for `fixedCount` responses, or rolls a number in `[minCount, maxCount]` at the moment that slot becomes active.

**Weighted-random**
- At each switch point, picks a slot via weighted random selection (weights from each slot's `weight` field).
- If `noRepeatInRow` is true and there are 2+ slots, re-rolls if the chosen slot matches the previous one.
- The chosen slot then runs for `weightedRunCount` responses (fixed or rolled from a range), then re-rolls.

### 3. Per-chat rotation state

```ts
type ChatRouletteState = {
  activeQueueId: string | null;       // which queue is running, null = rotation off
  currentSlotId: string | null;       // the slot currently in effect
  responsesRemaining: number;         // counter that decrements per accepted response
  lastSwitchMessageId: number | null; // message index where we last switched, for diagnostics
  history: Array<{                    // optional log: which profile generated which message
    messageId: number;
    profileName: string;
    timestamp: number;
  }>;
  manuallyOverridden: boolean;        // see "Manual override behavior"
};
```

### 4. Counter & switch logic

On every chat message advancing event (`MESSAGE_RECEIVED` for AI messages):
1. If rotation is off (`activeQueueId === null`), do nothing.
2. If `manuallyOverridden === true`, do nothing (rotation is paused until user re-enables).
3. Append to `history`.
4. Decrement `responsesRemaining`.
5. If `responsesRemaining > 0`, persist state and exit.
6. If `responsesRemaining <= 0`, this slot is done — flag that on the next `GENERATION_STARTED`, we need to switch.

On `GENERATION_STARTED` (just before the next AI generation):
1. If a switch is pending, compute the next slot:
   - **Sequential**: next slot in order, looping. Roll new `responsesRemaining` from the new slot's count config.
   - **Weighted-random**: pick by weight (with no-repeat-in-row check if enabled), roll new `responsesRemaining` from the queue's `weightedRunCount` config.
2. Fire `/profile <newProfileName>` via slash command.
3. Update `currentSlotId` and `responsesRemaining`.
4. Persist state.

On `MESSAGE_SWIPED`: do nothing. Swipes are same-slot retries by design.

### 5. Manual override behavior

If the user manually switches connection profiles via the existing ST UI (detected via `CONNECTION_PROFILE_LOADED` for a profile that doesn't match `currentSlotId`'s profile), set `manuallyOverridden = true`. The status indicator changes to "Rotation paused (manual override)" with a "Resume" button. Clicking Resume:
- If on the same profile a slot points to, set `manuallyOverridden = false` and continue from the current state.
- Otherwise, set `manuallyOverridden = false`, treat the next response as the start of a new rotation cycle (re-pick or advance).

### 6. Error handling

If a profile-switch fails (profile was deleted, slash command errors), skip that slot:
- **Sequential**: advance to the next slot.
- **Weighted-random**: re-roll, excluding the failed slot for this round.
- After 3 consecutive failures across different slots, halt rotation, set `activeQueueId = null`, surface a toast notification with the error.

### 7. UI

#### 7.1 Settings panel (Extensions drawer)
A standard ST extension settings block titled "Roulette" with:
- A list of saved queues (name, mode, slot count, edit/delete buttons).
- A "New Queue" button.
- A "Default queue for new chats" dropdown (optional convenience).

#### 7.2 Queue editor modal
Triggered by "New Queue" or editing an existing queue. Visual style: **clean modern dark, matching default SillyTavern aesthetics** — uses ST's existing CSS variables (`--SmartThemeBodyColor`, `--SmartThemeBlurTintColor`, `--SmartThemeBorderColor`, etc.), `Noto Sans` body, no custom fonts. Reuse ST's existing modal patterns (`.popup`, `.popup-content`) where possible so the modal feels native.

Layout:
- **Header**: Queue name input + mode toggle (Sequential / Weighted-Random).
- **Slot list**: drag-to-reorder list of slots. Each row shows:
  - Profile dropdown (populated from existing ST connection profiles — fetch via the same source ST's profile selector uses).
  - Mode-dependent fields:
    - *Sequential*: `Count` toggle (Fixed / Range) + number inputs.
    - *Weighted-random*: `Weight` number input (default 1).
  - Remove button.
- **Add slot** button.
- **Mode-specific footer**:
  - *Sequential*: nothing extra.
  - *Weighted-random*: "Run length" config (fixed or range), "No repeat in a row" toggle.
- **Save / Cancel** buttons.

Validation: cannot save with zero slots, cannot save with profile names that don't resolve to existing profiles (warn but allow — the user might create the profile later).

#### 7.3 Status indicator
A small persistent UI element (in the chat header area, near the existing model selector) showing:
- When rotation is **off**: nothing, or a small dimmed icon that opens the queue picker.
- When rotation is **on**: `🎲 [Queue name] · [Profile name] · N left` (where N is `responsesRemaining`).
- When **manually overridden**: `🎲 Paused · [Resume]`.

Click target opens a small popover with: current queue, current slot, "Stop rotation," "Switch queue," "Resume / Pause."

#### 7.4 Queue activation
A button or dropdown (in the status indicator popover, and also in the settings panel) to start a queue on the current chat. On activation:
- Set `activeQueueId`.
- Pick the starting slot:
  - *Sequential*: first slot.
  - *Weighted-random*: roll by weight.
- Fire the profile switch immediately so the next generation uses the right profile.
- Roll initial `responsesRemaining`.

### 8. Slash commands

Register Roulette commands so power users can script:
- `/roulette-start <queueName>` — activate a queue on the current chat.
- `/roulette-stop` — deactivate rotation.
- `/roulette-status` — print current state to the chat as a system message.
- `/roulette-skip` — force-advance to the next slot immediately.

Use ST's `SlashCommandParser.addCommandObject()` (verify exact import at scaffold time).

---

## Out of scope for v1 (document for v2)

- **Per-slot parameter overrides** beyond what the connection profile carries. v1 leans entirely on profiles; if the user wants "DeepSeek cold" and "DeepSeek warm," they make two profiles.
- **Blind mode** (hide which profile generated which message until reveal).
- **Per-character default queues**.
- **In-chat history visualization** beyond the metadata `history` array (which we record but don't render in v1).
- **Cross-chat statistics** (how often each profile was used, etc).

These are explicitly worth keeping in mind during architecture so v2 has a clean path. In particular: the `history` array should be populated from day one even though nothing renders it yet.

---

## Repository structure

```
SillyTavern-Roulette/
├── manifest.json              # ST extension manifest
├── index.js                   # entry point: registers settings UI, event listeners, slash commands
├── style.css                  # scoped styles using ST CSS variables
├── README.md                  # user-facing docs (install, usage, screenshots)
├── LICENSE                    # AGPL-3.0
├── src/
│   ├── state.js               # extension_settings + chat_metadata helpers
│   ├── rotation.js            # core rotation logic (pure functions, easily testable)
│   ├── profileSwitcher.js     # slash-command wrapper + error handling
│   ├── events.js              # event listener registration
│   ├── slashCommands.js       # /roulette-* command definitions
│   └── ui/
│       ├── settingsPanel.js   # extensions drawer settings block
│       ├── queueEditor.js     # the modal
│       ├── statusIndicator.js # the chat-header indicator + popover
│       └── templates.html     # any HTML fragments loaded via fetch
└── .gitignore
```

### `manifest.json`

```json
{
  "display_name": "Roulette",
  "loading_order": 100,
  "requires": [],
  "optional": [],
  "js": "index.js",
  "css": "style.css",
  "author": "Hyperion Blackthorne",
  "version": "0.1.0",
  "homePage": "https://github.com/<user>/SillyTavern-Roulette",
  "auto_update": true,
  "hooks": { "activate": "init" }
}
```

`hooks.activate` names an exported function in `index.js` that ST calls on activation (every bundled extension uses `init`). With it, `index.js` should `export async function init() { ... }`. Without it, ST still imports the module and runs top-level code, but using the hook gives us a clean activation point that runs *after* core ST is ready.

**Robustness pattern — self-invoke from top level.** In practice, `hooks.activate` has been observed to silently skip on some installs (likely a stale browser-cached `manifest.json` after re-install — `extensions.js:414` and `:418` both `return;` without logging if the fetched manifest lacks `hooks` or the named hook key). To survive that, `index.js` schedules `init()` from a top-level `Promise.resolve().then(init)` *in addition to* exporting it for the hook. Both call paths are made safe by per-subsystem idempotency guards:

- `registerEventListeners` — `registered` flag in `src/events.js`
- `registerSlashCommands` — `registered` flag in `src/slashCommands.js`
- `mountSettingsPanel` — `mounted` flag in `src/ui/settingsPanel.js`
- `mountStatusIndicator` — `pillEl` null-check in `src/ui/statusIndicator.js`
- `init()` itself — `initialized` flag in `index.js`, reset to `false` on error to allow retry

Net effect: the hook is the canonical path when it works; the self-invoke is a no-cost safety net when it doesn't.

---

## Implementation notes

### Verified import paths (third-party extension at `public/scripts/extensions/third-party/SillyTavern-Roulette/`)

| Symbol | Path |
|---|---|
| `eventSource`, `event_types`, `saveSettingsDebounced`, `chat_metadata` | `../../../../script.js` |
| `extension_settings`, `saveMetadataDebounced`, `getContext`, `renderExtensionTemplateAsync` | `../../../../scripts/extensions.js` |
| `executeSlashCommandsWithOptions` | `../../../../scripts/slash-commands.js` |
| `SlashCommandParser` | `../../../../scripts/slash-commands/SlashCommandParser.js` |
| `SlashCommand` (use `SlashCommand.fromProps({...})`) | `../../../../scripts/slash-commands/SlashCommand.js` |
| `SlashCommandArgument`, `SlashCommandNamedArgument`, `ARGUMENT_TYPE` | `../../../../scripts/slash-commands/SlashCommandArgument.js` |
| `Popup`, `callGenericPopup`, `POPUP_TYPE`, `POPUP_RESULT` | `../../../../scripts/popup.js` |

The `../../../../` depth in the table above is for **`index.js` at the extension root**. Files nested deeper need one extra `../` per level: `src/*.js` use `../../../../../`, `src/ui/*.js` use `../../../../../../`. Verified against canonical install location `public/scripts/extensions/third-party/<ext>/`. Built-in extensions live one directory shallower and use one fewer `../`; we are not built-in.

### Connection profile enumeration
ST stores connection profiles in `extension_settings.connectionManager.profiles` (verified — `public/scripts/extensions.js:172`). Each profile is a `ConnectionProfile` with at least `id` and `name` (full JSDoc at `public/scripts/extensions/connection-manager/index.js:159`). The currently selected profile is tracked as an **id** at `extension_settings.connectionManager.selectedProfile`, *not* a name — convert when comparing.

The queue editor's profile dropdown should read from this list directly and refresh on `CONNECTION_PROFILE_LOADED`, `CONNECTION_PROFILE_CREATED`, `CONNECTION_PROFILE_DELETED`, `CONNECTION_PROFILE_UPDATED`, and on modal open. **Do not cache** the profile list — the user may add/remove profiles between sessions.

### Modals — use ST's `Popup` class
Use the `Popup` class from `../../../../scripts/popup.js` for the queue editor instead of rolling our own modal. It handles z-index, focus trap, escape-to-cancel, and theme-correct styling automatically. `POPUP_TYPE.TEXT` for content-driven popups, `POPUP_RESULT` for return-value comparison. The convenience function `callGenericPopup(content, type, inputValue, popupOptions)` is fine for simple cases; reserve the `new Popup(...)` constructor for the queue editor where we need custom buttons and form state.

### Concurrency / race conditions
The flow `MESSAGE_RECEIVED → decrement → flag pending switch → GENERATION_STARTED → switch → generate` has a potential race: what if the user hits Generate again very quickly, or two generations are queued? Profile switches via slash command are async. Strategies:
1. Make the `GENERATION_STARTED` handler `await` the profile switch completion before yielding control.
2. If `GENERATION_STARTED` fires while a previous switch is mid-flight, queue the new switch attempt.
3. Use a simple in-memory `isSwitching` flag to guard.

Test this carefully with rapid-fire generations and swipes.

### Defensive profile resolution
Before firing `/profile <name>`, verify the profile still exists. If it doesn't, treat as the error case in section 6.

### Persistence timing
Persist `chat_metadata.roulette` after every state mutation (post-decrement, post-switch). Persist `extension_settings.roulette` on queue create/edit/delete. Use the debounced helpers; don't write synchronously on every message.

### Style scoping
All CSS rules under a single root class (e.g. `.roulette-extension`) to avoid bleeding into ST's UI. Use CSS variables ST exposes for colors and borders so dark/light theme switches work without extra code.

---

## Acceptance criteria for v1

The extension is "done" for v1 when all of the following are true on a fresh ST install:

1. Installing via Extensions → Install from URL works without errors.
2. The Roulette panel appears in the Extensions drawer.
3. A user with at least 2 connection profiles can create a queue, save it, and activate it on a chat.
4. In **sequential** mode with fixed counts (e.g. A=3, B=2, C=4), generating 9 messages causes the active profile to be A for the first 3, B for the next 2, C for the next 4. Verified by checking the connection profile selector value before each generation.
5. Swiping a message (regenerate-as-swipe) does not advance the counter — verified via the `type === 'swipe'` filter on `MESSAGE_RECEIVED`.
6. Regenerating a message does not advance the counter — verified via the `type === 'regenerate'` filter on `MESSAGE_RECEIVED`.
7. In **weighted-random** mode with weights 1/1/1 and run length 1, profiles switch every message and over 100 messages each profile is used roughly evenly (within reasonable variance).
8. With `noRepeatInRow: true`, no two consecutive responses ever come from the same profile (verified over 50+ messages).
9. Switching chats preserves each chat's independent rotation state.
10. Manually switching profiles mid-rotation pauses the rotation and surfaces the "Resume" affordance.
11. Deleting a profile that's in an active queue triggers the error path: that slot is skipped, rotation continues with the remaining profiles.
12. The status indicator updates within one frame of any state change.
13. All four slash commands (`/roulette-start`, `/roulette-stop`, `/roulette-status`, `/roulette-skip`) work and produce sensible output.
14. No console errors during normal use.
15. The modal renders cleanly in both ST's light and dark themes.

---

## Verified ST internals

Verified against `SillyTavern/SillyTavern@release` at commit `51ad27f` (Merge PR #5591). All paths and identifiers below are quoted from that revision; re-verify if upgrading to a much newer ST.

1. **Import paths** — see the table in "Verified import paths" under Implementation notes. `../../../../` is the correct depth for third-party extensions.
2. **Event name strings** — all confirmed in `public/scripts/events.js`:
   `MESSAGE_RECEIVED='message_received'` · `MESSAGE_SWIPED='message_swiped'` · `GENERATION_STARTED='generation_started'` · `GENERATION_ENDED='generation_ended'` · `CHAT_CHANGED='chat_id_changed'` · `CONNECTION_PROFILE_LOADED='connection_profile_loaded'` · `CHARACTER_MESSAGE_RENDERED='character_message_rendered'`.
   `MESSAGE_RECEIVED` and `GENERATION_STARTED` carry generation-`type` payload args — see "Hook points" above for the full type-string list and filter rules.
3. **Connection profiles in state** — `extension_settings.connectionManager.profiles` (array of `{id, name, ...}`); selected id at `extension_settings.connectionManager.selectedProfile`. ConnectionProfile JSDoc at `public/scripts/extensions/connection-manager/index.js:159-182`.
4. **`CONNECTION_PROFILE_LOADED` and our own switches** — confirmed: yes, the event fires for our `/profile` calls too (the change-handler at `public/scripts/extensions/connection-manager/index.js:752` emits unconditionally). We must use an `isInternalSwitch` flag.
5. **Manifest schema** — fields ST honors: `display_name`, `loading_order`, `requires`, `optional`, `js`, `css`, `author`, `version`, `homePage` (camelCase), `auto_update`, `hooks` (`{activate: 'init'}` convention), plus optional `i18n` and `generate_interceptor`. All bundled extensions use `hooks.activate = 'init'` and we will too.
6. **Popup helper** — yes: `Popup` class at `public/scripts/popup.js:148`, `callGenericPopup` at line 909, `POPUP_TYPE`/`POPUP_RESULT` enums. Use these instead of rolling a custom modal.

---

## Stretch / nice-to-have for v1 if time permits

- A "test rotation" button in the queue editor that simulates 20 picks and shows the profile sequence so the user can sanity-check their config without committing.
- Export/import queues as JSON (community sharing).
- Keyboard shortcut to open the queue picker.
