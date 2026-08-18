# SillyTavern Roulette

A SillyTavern extension that rotates between connection profiles during roleplay — sequentially or by weighted random — so the user can mix models, parameters, and providers throughout a chat without manually switching.

**Version:** 1.3.0
**License:** AGPL-3.0 (matches SillyTavern)
**Target:** SillyTavern 1.12+ (uses Connection Manager / connection profiles API)
**Repo name:** `SillyTavern-Roulette`
**Extension display name:** `Roulette`

---

## Concept

Users select multiple SillyTavern connection profiles, drop them into a "queue," set a rotation policy (sequential with fixed or ranged response counts, or weighted-random), and the extension automatically switches the active connection profile as the chat proceeds. State is per-chat. A small status indicator surfaces the current profile and how many responses remain in the current slot.

Because the unit of rotation is the **connection profile**, the extension does not need to know anything about individual providers, API endpoints, model names, or sampler parameters — all of that lives in the profile itself. The extension is a *scheduler* that calls the existing profile-switch slash command at the right moments.

The v1.0 UI is centred on a **modal with a glassy revolver-cylinder visualisation**: the active queue's slots become chambers in a brass-collared cylinder, and rotation advances are shown as the cylinder spinning to bring the next chamber into firing position. The drawer block in SillyTavern's Extensions panel is a trimmed quick-access surface (status + start/stop + Open Roulette button).

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
- `CHARACTER_DELETED` — emitted with `({ id, character })`. Purge that character's queue binding.
- `CHARACTER_RENAMED` — emitted with `(oldAvatar, newAvatar)`. Avatar filenames track the character name, so a rename moves our binding key; re-point it or the binding is silently orphaned.
- `APP_READY` — boot-time safety net for character-binding auto-start. `eventSource` is constructed with `autoFireAfterEmit` covering `APP_READY`, so a listener registered *after* the event already fired is invoked immediately with the last args. ST inits extensions before loading the first chat, so `CHAT_CHANGED` normally covers startup on its own; this is belt-and-braces for late-loading installs.

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
- **Global settings** (rotation queues the user has defined, default rotation, UI preferences, per-character queue bindings) → `extension_settings.roulette` (persisted via `saveSettingsDebounced()`).
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
- `/roulette-bind <queueName>` — bind the current character to a queue (auto-starts on chat load).
- `/roulette-unbind` — remove the current character's binding.

Use ST's `SlashCommandParser.addCommandObject()` (verify exact import at scaffold time).

---

### 9. Per-character queue bindings (v1.3)

"Open this character's chat, run this queue." Bindings live in
`extension_settings.roulette.characterQueues` as `{ [avatarFilename]: queueId }`.

**Keying.** Characters are keyed by **avatar filename**, never by `this_chid`.
`this_chid` is an index into the live `characters` array and shifts whenever a
character is added, deleted, or the list is re-sorted — persisting it would
silently re-point bindings at the wrong character. The avatar filename is what
ST core and every bundled extension (quick-reply, gallery, attachments, stats)
uses for per-character storage.

**Group chats are excluded.** `getCurrentCharacter()` returns `null` while
`groupId` is set, which makes every binding path inert there. This matches
quick-reply's per-character config, which bails on `selected_group` for the
same reason: a group has several members and no non-arbitrary answer to
"whose binding wins?".

**Activation rules.** The precedence logic is a pure function,
`decideAutoActivation()` in `rotation.js`, so it can be tested without ST:

| Situation | Action |
|---|---|
| No character (group chat / nothing loaded) | `none` |
| Character has no binding | `none` |
| `autoBindHandled` already set for this chat | `none` |
| Chat already has a rotation running | `mark-handled` — never clobber it |
| Bound queue no longer exists | `clear-binding` |
| Otherwise | `start` |

**The `autoBindHandled` latch** (per-chat, in `chat_metadata.roulette`) is what
makes auto-start tolerable. `stopRotation()` sets it, so a rotation the user
deliberately stopped does not resurrect every time the chat is reopened;
`startRotation()` sets it too, since the question is then settled either way.
`reevaluateAutoActivation()` clears it on purpose when the user changes a
binding from the UI, so binding a character while sitting in their chat takes
effect immediately instead of appearing to do nothing.

Note the ordering: the running-rotation check comes *before* the stale-queue
check, so we never mutate settings while a rotation the user cares about is
mid-flight.

**Lifecycle.** `CHARACTER_DELETED` purges the binding; `CHARACTER_RENAMED`
moves it to the new avatar key; `deleteQueue()` prunes any bindings pointing at
the removed queue (done inline in `state.js` — routing it through
`characterBinding.js` would form an import cycle, since that module imports
`state.js`).

**UI.** Two surfaces, one map: a contextual `Auto-start for <character>` select
in the Chamber tab, and a masks-icon character multi-select on each queue card
in the Queues tab (`src/ui/bindingPicker.js`). A character has at most one
queue, so the picker calls out characters already bound elsewhere rather than
silently rebinding them.

---

## Shipped in v1.0 (originally out-of-scope or stretch)

These were called out as v2 / stretch in the original spec but landed in v1.0:

- **In-chat history visualisation** — `tabs/history.js` renders the trail strip + newest-first row list from `chat_metadata.roulette.history`.
- **"Test rotation" simulate-20-picks button** — in the queue editor, runs `pickInitialSlot` + `advanceSlot` against the in-modal queue without saving, displays roll-by-roll output (each `advanceSlot` is its own run, so adjacent same-profile rolls don't visually merge).
- **Queue export / import as JSON** — `src/exportImport.js`. Per-queue download icons + Export-all + Import. Envelope is `{ kind, schema, exportedAt, queue|queues }`; import accepts envelope, bare queue, or bare-array forms.
- **Drag-to-reorder slots** — HTML5 drag-and-drop in the queue editor with grip handle, dashed-outline drop target, reduced-opacity source.
- **Glassy revolver-cylinder UI + tabbed modal** — the v1.0 visual redesign. See `src/ui/modal.js`, `src/ui/cylinder.js`, and `src/ui/tabs/*` for structure.
- **User UI prefs (animation speed, accent colour)** — persisted in `extension_settings.roulette.ui`; `applyUiSettings()` injects a `<style id="roulette-ui-overrides">` block to override `--roulette-*` tokens at runtime.
- **Light + dark theme rendering** — modal owns its own dark canvas via `--roulette-*` tokens, independent of ST theme. Drawer + pill use ST CSS variables to blend with chat chrome.

## Still out of scope (genuine v2)

- **Per-slot parameter overrides** beyond what the connection profile carries. v1.0 leans entirely on profiles; for "DeepSeek cold" vs "DeepSeek warm", make two profiles.
- **Blind mode** (hide which profile generated which message until reveal).
- **Cross-chat statistics** (how often each profile was used over all time, summary dashboards).
- **Drag-load metaphor (variant L)** — the queue's chambers being directly loaded by dragging profile chips onto the cylinder, with the queue abstraction implicit. v1.0 ships variant P (read-only Chamber tab; editing in Queues tab).

---

## Repository structure (v1.3)

```
SillyTavern-Roulette/
├── manifest.json              # ST extension manifest
├── package.json               # node-only: `npm test`, type:module. ST ignores it.
├── index.js                   # entry point: init() wires every subsystem
├── style.css                  # scoped styles + --roulette-* token set
├── README.md                  # user-facing docs (value, install, recipes)
├── TESTING.md                 # manual acceptance-criteria walkthrough
├── LICENSE                    # AGPL-3.0
├── src/
│   ├── state.js               # extension_settings + chat_metadata helpers; UI prefs
│   ├── rotation.js            # PURE core logic (no ST imports) — scheduling + auto-activation rules
│   ├── profileSwitcher.js     # /profile slash-command wrapper + isInternalSwitch flag
│   ├── events.js              # ST event listeners + scheduler (start/stop/skip/spin/auto-start)
│   ├── characterBinding.js    # per-character queue bindings; ALL character-identity handling
│   ├── sampling.js            # v1.2 per-slot sampler tuning via ST's preset system
│   ├── slashCommands.js       # /roulette-* command definitions
│   ├── exportImport.js        # queue JSON file download/upload helpers
│   └── ui/
│       ├── modal.js           # tabbed modal chassis (Chamber/Queues/History/Settings)
│       ├── cylinder.js        # SVG glassy revolver-cylinder + spin animation
│       ├── widget.js          # v1.1 floating draggable mini-cylinder panel
│       ├── bindingPicker.js   # character multi-select popup, opened from a queue card
│       ├── profileColors.js   # hash-based stable profile colour assignment
│       ├── queueEditor.js     # form builder shared by popup + embedded paths
│       ├── settingsPanel.js   # drawer block: status + quick actions + Open Roulette
│       ├── statusIndicator.js # chat-input pill (icon by default, hover for details)
│       ├── templates.html     # reserved for future fragments (currently empty)
│       └── tabs/
│           ├── chamber.js     # cylinder hero + status + actions + character-binding row
│           ├── queues.js      # card grid + inline editor (replaces right pane)
│           ├── history.js     # trail strip + per-pick rows
│           └── settings.js    # animation-speed slider + accent-colour picker
├── tests/
│   └── rotation.test.mjs      # node --test over the pure core (no ST, no DOM, no mocks)
└── .gitignore
```

### Tests

`src/rotation.js` imports nothing, so it runs under plain node:

```
npm test          # node --test tests/*.test.mjs
```

Covers slot sequencing, the `noRepeatInRow` guarantee, weighted distribution,
the generation-type filter, and the auto-activation precedence rules. Anything
touching ST's event system or the DOM stays in `TESTING.md` as a manual walk.
Keep `rotation.js` ST-free — that property is what makes this possible.

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
  "version": "1.3.0",
  "homePage": "https://github.com/hype-hosting/SillyTavern-Roulette",
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
All CSS rules under a single root class (e.g. `.roulette-extension`) to avoid bleeding into ST's UI. The drawer + pill use ST CSS variables (`--SmartThemeBodyColor` etc.) so they blend with chat chrome. The modal owns its own `--roulette-*` token set scoped to `.roulette-extension`, so its identity is stable regardless of ST theme. The user can override `--roulette-accent`, `--roulette-glow`, and `--roulette-glow-strong` via the Settings tab; `applyUiSettings()` (in `state.js`) writes them into a single `<style id="roulette-ui-overrides">` block in `<head>`.

### Modal architecture (v1.0)
`src/ui/modal.js` owns the tabbed modal. Mounted via ST's `Popup` class with `POPUP_TYPE.DISPLAY`. Tab rail uses ARIA `tablist` semantics + arrow-key navigation. Tab modules under `src/ui/tabs/` each export `mount(container)` and `refresh(container)`. The modal subscribes to `onRotationStateChanged` from `events.js` and calls `refresh` on the active tab.

The cylinder (`src/ui/cylinder.js`) is the centrepiece. Two key implementation notes:

- **Pivot rotation** uses `transform-box: view-box` + `transform-origin: 50% 50%` so the rotation centre is the SVG viewBox centre, geometry-independent. Earlier iterations used `fill-box` and produced post-spin vertical drift because the active chamber's halo extended past the collar on whichever side the chamber currently sat — making the bbox asymmetric and the bbox-relative pivot drift by 1-2 pixels per spin.
- **Counter-rotation groups** (`.roulette-counter-rotate`) wrap chamber labels and any "lighting" decoration that should stay world-upright as the cylinder rotates. `spinCylinderTo` updates the pivot's CSS transform AND every counter-rotate group's SVG transform attribute in lock-step; matching CSS transitions on both keep them synchronised through the spin.

Sequential mode rotates by `360/N` per advance (snappy 420ms ease-out); weighted-random rotates by an integer number of full revolutions plus the target offset (1600ms long ease-out). The integer revolution count is critical — non-integer extras leave the cylinder offset from the target chamber by a fraction of a turn.

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
7. **Character identity** — `getContext()` (re-exported from `public/scripts/extensions.js:14-18`, defined in `public/scripts/st-context.js:114`) returns `characters`, `characterId` (`this_chid`), `groupId` (`selected_group`), and `groups`. `characterId` is an **array index**, not a stable id: the canonical stable key is `characters[this_chid].avatar`, used throughout ST core (`chats.js`, `tags.js`, `stats.js`, `personas.js`) and by bundled extensions. Group ids (`groups[].id`) are server-assigned on create and stable.
8. **`chat_metadata` is bound before `CHAT_CHANGED`** — `public/script.js:7598` assigns `chat_metadata` from the chat header; the event emits at `:7641`. Reading the incoming chat's rotation state inside a `CHAT_CHANGED` handler is therefore safe.
9. **Extensions init before the first chat loads** — `firstLoadInit()` calls `await initExtensions()` (`public/script.js:745`) before `getCharacters()` and everything else, so listeners registered during extension init do receive the first `CHAT_CHANGED`.
10. **`APP_READY` replays to late listeners** — `eventSource = new EventEmitter([APP_READY, APP_INITIALIZED])` (`public/scripts/events.js:113`); `EventEmitter.prototype.on` invokes the listener immediately if the event is in `autoFireAfterEmit` and has already fired (`public/lib/eventemitter.js`). Safe to rely on for catch-up work.

---

## v1.1 – v1.3 — done

- **v1.1** — floating draggable widget (`src/ui/widget.js`) mirroring the cylinder during chat; glassmorphism + spring-easing pass; RGB-tuple token system.
- **v1.2** — per-slot inline sampler tuning (`src/sampling.js`) overlaid through ST's preset machinery, with managed presets cleaned up on slot/queue removal.
- **v1.3** — per-character queue bindings (`src/characterBinding.js`, `src/ui/bindingPicker.js`) plus the first automated test coverage of the pure core.

## v1.0 milestone — done

The original v1 acceptance criteria all pass (see `TESTING.md` for the manual walkthrough). The modal redesign, glassy cylinder, drag-to-reorder, simulate-20-picks, queue export/import, history view, and user UI prefs all shipped on top.

## Future work

- **Blind mode** — hide which profile generated which message until the user reveals.
- **Drag-load chamber metaphor** — drop profile chips directly onto chambers; the queue becomes implicit. Bigger UX change; wait until users ask for it.
- **Cross-chat statistics** — total runs per profile, distribution dashboards.
- **Keyboard shortcut to open the modal** (currently only the pill click + drawer button).
- **Per-slot parameter overrides** — would mean reaching past the connection profile to override sampler settings. Architecturally clean to defer.
