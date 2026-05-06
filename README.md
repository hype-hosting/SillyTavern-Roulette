# SillyTavern-Roulette

A SillyTavern extension that rotates between connection profiles during a chat — sequentially or by weighted random — so you can mix models, parameters, and providers without manually switching. Built around a glassy revolver-cylinder visualisation of your active rotation.

**Version 1.0 · AGPL-3.0 · SillyTavern 1.12+**

---

## Why use it

- **Beat prose fatigue.** Long chats with a single model develop visible patterns — the same sentence rhythms, the same body-language tics. Rotating in even one alternate model every few turns keeps the prose feeling fresh across thousands of messages.
- **Pace your spend.** Mix a flagship model with a cheap one on a 1-in-5 schedule. You spend most turns on cheap inference and reserve the premium model for variety, without ever clicking a switch.
- **Mitigate refusals.** Different models have different rails. When one balks at a scene, the next switch quietly hands the keyboard to a model with different boundaries. Less re-rolling, less interruption.
- **Discover models without committing.** Drop a candidate into the rotation alongside your favourites. Get an honest, organic side-by-side over a real chat instead of a one-shot evaluation.

The more important your chat is to you, the more value Roulette adds.

---

## Install

In SillyTavern: **Extensions → Install Extension → Install from URL** and paste this repository's URL.

Manual install: clone into `data/<user>/extensions/SillyTavern-Roulette/` (per-user) or `public/scripts/extensions/third-party/SillyTavern-Roulette/` (global), then enable in the Extensions panel.

**Requires** at least two connection profiles defined in SillyTavern's Connection Profiles extension.

---

## Quick start (3-model rotation)

Assumes Roulette is already installed.

1. **Define three connection profiles** in SillyTavern's Connection Profiles UI. Pick three different models you want in the mix — e.g. `Sonnet 4.5`, `GLM-4.7`, `DeepSeek v3`. Give them clear names; you'll pick from these names in step 3.
2. **Open the Roulette modal** — click the dice icon next to the chat input, or the **Open Roulette** button in the Extensions drawer.
3. **Queues tab → New queue.** Name it something memorable (e.g. *Long-fiction blend*). Pick **Sequential** mode, drag in your three profiles, and set each slot's count (a good starting blend: `Sonnet=3`, `GLM=2`, `DeepSeek=4`).
4. **Save.** The queue appears as a card with a mini-cylinder preview. Click **Simulate 20 picks** in the editor first if you want to sanity-check the sequence.
5. **Chamber tab → Spin** (or use the drawer's queue picker + Start). The cylinder loads, and from now on each AI response rotates through the chambers automatically.

The pill in the chat input shows the active queue and how many responses remain in the current slot. Hover for detail; click to reopen the modal.

---

## Recipes

Three queue configurations that map to common roleplayer goals.

### Long-fiction blend (sequential)

Three frontier models in sequence, biased toward your favourite. Prevents prose fatigue across long arcs.

| Slot | Profile | Count |
|---|---|---|
| 1 | Your favourite (e.g. Sonnet) | 3 |
| 2 | Alternate voice (e.g. GLM or Gemini) | 2 |
| 3 | Tertiary (e.g. DeepSeek) | 4 |

Mode: **Sequential**. Total: ~9 turns per cycle.

### Budget classic (weighted-random)

Cheap model handles 80% of turns; flagship steps in occasionally for variety.

| Slot | Profile | Weight |
|---|---|---|
| 1 | Cheap workhorse (open-router free tier, local Llama, etc.) | 4 |
| 2 | Flagship treat (Sonnet, Gemini Pro, GPT-5) | 1 |

Mode: **Weighted-random**. Run length: range `1-3`. No-repeat: off.

### Personality split (sequential, no-repeat)

A character with two distinct internal voices. Each turn alternates between the two — same character, two minds.

| Slot | Profile | Count |
|---|---|---|
| 1 | "Voice A" profile (warm, verbose) | 1 |
| 2 | "Voice B" profile (cold, terse) | 1 |

Mode: **Sequential** with count 1 each (every turn switches). Or use **Weighted-random** with `no-repeat-in-row` enabled and equal weights for non-rigid alternation.

### TTRPG dice (weighted-random with wildcard)

For users who like genuine narrative randomness — most turns are predictable, occasionally something unexpected happens.

| Slot | Profile | Weight |
|---|---|---|
| 1 | Reliable narrator | 5 |
| 2 | Reliable narrator (alt) | 3 |
| 3 | Wildcard (a model known to surprise you) | 1 |

Mode: **Weighted-random**. Run length: range `1-2`.

---

## Modes & options

**Sequential** — walks slots in order, looping back to the start. Each slot runs for either a *fixed* count or a *range* (rolled when that slot becomes active).

**Weighted-random** — picks a slot by weighted random selection on each rotation boundary. Options:
- *Run length* (fixed or range): how many responses each randomly-picked slot runs for.
- *Don't repeat the same profile twice in a row*: forces variety.

**Per-chat state** — every chat tracks its own rotation independently. Switch chats, and each one keeps its own active queue, slot, and counter.

**Manual override** — if you switch profiles via SillyTavern's normal selector mid-rotation, Roulette pauses with a *Resume* affordance until you decide to continue.

**Profile-deletion error path** — if a slot's profile is deleted, Roulette skips it and continues. Three consecutive failed slots halts the rotation with a toast.

---

## Slash commands

- `/roulette-start <queueName>` — activate a queue on the current chat
- `/roulette-stop` — deactivate
- `/roulette-status` — print current state
- `/roulette-skip` — force-advance to the next slot

---

## What's in the modal

- **Chamber** — the live cylinder. Brass collar around glassy chambers, active chamber highlighted with a brass glow + pip ring counting down responses-remaining. Sequential clicks one notch per advance; weighted-random spins with wheel-of-fortune deceleration.
- **Queues** — card grid of saved queues, each with a mini-cylinder preview. Click to edit (drag-to-reorder slots, simulate 20 picks live). Import / export as JSON for sharing.
- **History** — every AI response logged with its profile of origin. Trail strip shows the last twelve, full list newest-first.
- **Settings** — animation speed slider (0.25× to 2×), accent-colour picker (six metal presets + custom), profile-palette display.

---

## License

[AGPL-3.0](./LICENSE) — matches SillyTavern's license.
