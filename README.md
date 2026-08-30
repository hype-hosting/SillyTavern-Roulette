![Roulette Banner](assets/banner.jpg)

# SillyTavern-Roulette

**A premium connection-profile rotation extension for SillyTavern by Hyperion.**

Roulette rotates between SillyTavern connection profiles during a chat — sequentially or by weighted random — so you can mix models, parameters, and providers without manually switching. A slim pinned bar in the chat shows the rotation as a line of colored dots — one per slot, with the live slot lit up and counting down — so you always know what's talking and what's next.

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/hype)
[![Discord](https://img.shields.io/badge/Join%20the-Discord-5865F2?logo=discord&logoColor=white)](https://discord.gg/therealhype)
[![Substack](https://img.shields.io/badge/Read-The%20Hyperium-FF6719?logo=substack&logoColor=white)](https://hyperionblackthorne.substack.com)

---

## Why Roulette

The longer your chat runs, the more value Roulette adds. Four reasons most users install it:

| Reason | What it solves | Best for |
|---|---|---|
| **Beat prose fatigue** | Long single-model chats develop visible patterns — same rhythms, same body-language tics. Even one alternate model in the rotation breaks the spell. | Long-running characters, multi-thousand-message arcs. |
| **Pace your spend** | Schedule a flagship model 1-in-5 alongside a cheap workhorse. Most turns cost pennies; the premium model lands occasionally for variety. | Anyone juggling API budgets. |
| **Mitigate refusals** | Different models have different rails. When one balks, the next switch hands the keyboard to a model with different boundaries. | Mature scenes, edge cases, anyone tired of re-rolling. |
| **Discover models honestly** | Drop a candidate into the rotation and let it co-exist with your favourites for a few sessions. Real side-by-side, in your real chat. | Evaluating new providers without rebuilding your setup. |

---

## Install

In SillyTavern: **Extensions → Install Extension → Install from URL** and paste:

```
https://github.com/hype-hosting/SillyTavern-Roulette
```

Manual install: clone into `data/<user>/extensions/SillyTavern-Roulette/` (per-user) or `public/scripts/extensions/third-party/SillyTavern-Roulette/` (global), then enable in the Extensions panel.

**Requires** at least two connection profiles defined in SillyTavern's Connection Profiles extension.

---

## Quick Start

A 3-model rotation in five steps. Assumes Roulette is installed.

1. **Define three connection profiles** in SillyTavern's Connection Profiles UI. Pick three different models you want in the mix — e.g. `Sonnet 4.5`, `GLM-4.7`, `DeepSeek v3`. Give them clear names; you'll pick from these names in step 3.
2. **Open Roulette** — click the gear on the Roulette bar above the message input, or **Settings** in the Extensions drawer.
3. **Queues tab → New queue.** Name it (e.g. *Long-fiction blend*). Pick **Sequential** mode, add your three profiles, set each slot's count (try `Sonnet=3`, `GLM=2`, `DeepSeek=4`).
4. **Save.** The queue appears as a card with a dot-strip preview. Click **Simulate 20 picks** in the editor first if you want to sanity-check the sequence.
5. **Press ▶ on the bar.** The dots light up, and from now on each AI response advances the rotation automatically.

The bar shows the whole rotation at a glance: one dot per slot in queue order, the active slot lit with the number of responses it has left, plus Skip and Stop. If you'd rather not see it, **Disable Roulette** in the Extensions drawer hides it without stopping anything.

---

## Recipes

Four queue configurations that map to common roleplayer goals. Drop into the editor, save, run.

### Long-fiction blend (sequential)

Three frontier models in sequence, biased toward your favourite. Prevents prose fatigue across long arcs.

| Slot | Profile | Count |
|---|---|---|
| 1 | Your favourite (e.g. Sonnet) | 3 |
| 2 | Alternate voice (e.g. GLM or Gemini) | 2 |
| 3 | Tertiary (e.g. DeepSeek) | 4 |

Mode: **Sequential** · ~9 turns per cycle.

### Budget classic (weighted-random)

Cheap model handles 80% of turns; flagship steps in occasionally for variety.

| Slot | Profile | Weight |
|---|---|---|
| 1 | Cheap workhorse (free-tier OpenRouter, local Llama, etc.) | 4 |
| 2 | Flagship treat (Sonnet, Gemini Pro, GPT-5) | 1 |

Mode: **Weighted-random** · run length range `1–3` · no-repeat off.

### Personality split (alternating)

A character with two distinct internal voices. Each turn alternates — same character, two minds.

| Slot | Profile | Count |
|---|---|---|
| 1 | "Voice A" (warm, verbose) | 1 |
| 2 | "Voice B" (cold, terse) | 1 |

Mode: **Sequential** with count `1` each. Or **Weighted-random** with `no-repeat-in-row` enabled and equal weights for non-rigid alternation.

### TTRPG dice (weighted with wildcard)

Most turns are predictable; occasionally something unexpected happens. Genuine narrative randomness.

| Slot | Profile | Weight |
|---|---|---|
| 1 | Reliable narrator | 5 |
| 2 | Reliable narrator (alt) | 3 |
| 3 | Wildcard (a model known to surprise you) | 1 |

Mode: **Weighted-random** · run length range `1–2`.

---

## Per-Character Queues

Different characters want different rotations. A hard-boiled detective and a
whimsical fae shopkeeper rarely benefit from the same blend of models.

Bind a queue to a character once and it starts itself from then on:

- **In the modal** — open **Rotation** while that character's chat is loaded and
  pick a queue from **Auto-start for _character_**.
- **From a queue** — in **Queues**, click the characters icon on a queue card
  and tick every character that should use it.
- **From chat** — `/roulette-bind Long-fiction blend`.

Opening one of that character's chats then starts the queue and switches the
connection profile before the first generation. Three rules keep it out of your
way:

| Situation | What happens |
|---|---|
| Chat already has a rotation running | Left completely alone — the running rotation always wins |
| You stopped rotation in that chat | Stays stopped, even after reopening it |
| Group chat | Bindings don't apply; a group has several members and no obvious winner |

A character can have one queue; a queue can serve any number of characters.
Renaming or deleting a character updates or removes its binding automatically.

---

## Modes & Options

| Mode | Behaviour |
|---|---|
| **Sequential** | Walks slots in order, looping back to the start. Each slot runs for either a *fixed* count or a *range* (rolled when the slot becomes active). |
| **Weighted-random** | Picks a slot by weighted random selection on each rotation boundary. Run length is fixed or rolled from a range. Optional *don't repeat the same profile twice in a row* toggle forces variety. |

**Per-chat state** — every chat tracks its own rotation independently. Switch chats, and each one keeps its own active queue, slot, and counter.

**Manual override** — if you switch profiles via SillyTavern's normal selector mid-rotation, Roulette pauses with a *Resume* affordance until you decide to continue.

**Profile-deletion error path** — if a slot's profile is deleted, Roulette skips it. Three consecutive failed slots halts the rotation with a toast.

---

## What's in the Modal

| Tab | What it is |
|---|---|
| **Rotation** | The live dot strip — one dot per slot, active slot glowing with its responses-remaining count — plus Start / Skip / Stop / Resume, an **Auto-start for _character_** picker, and the pick history: a trail strip of recent picks and a full newest-first log of which profile wrote which message. |
| **Queues** | Card grid of saved queues, each with a dot-strip preview. Click to edit (drag-to-reorder slots, simulate 20 picks live). The characters icon opens a picker — bind many characters to one queue at once. Import / export as JSON for sharing. |
| **Settings** | Pinned bar visibility + position (above the message bar, below it, or above the chat), animation speed slider (0.25× to 2×), accent-colour picker, profile-palette display. |

---

## Slash Commands

| Command | Effect |
|---|---|
| `/roulette-start <queueName>` | Activate a queue on the current chat |
| `/roulette-stop` | Deactivate rotation |
| `/roulette-status` | Print current state |
| `/roulette-skip` | Force-advance to the next slot |
| `/roulette-bind <queueName>` | Auto-start that queue whenever the current character is loaded |
| `/roulette-unbind` | Remove the current character's binding |

---

## Versions

| Version | Status | Notes |
|---|---|---|
| v2.0.2 | **Current** | Weighted-random dots are drawn round again — equal weights now render at identical sizes, on every browser and display scaling. |
| v2.0.1 | | Post-release polish — cleaner resume after manual overrides, single error toasts, editor prefill fixes, and self-healing cleanup of sampler-tuning presets when queues are renamed. |
| v2.0 | | Full UI redesign — the revolver cylinder, floating widget, and chat-input pill are replaced by a linear dot strip and a slim pinned bar (position configurable). Cool near-black theme, denser modal, three tabs. |
| v1.3 | | Per-character queue bindings — open a character's chat, their queue starts itself. |
| v1.2 | | Inline sampler tuning per slot, overlaid through SillyTavern's preset system. |
| v1.1 | | Floating draggable widget mirroring the cylinder during chat; glassmorphism pass. |
| v1.0 | | Initial public release. Modal redesign, glassy cylinder, drag-to-reorder, simulate-20-picks, queue export/import, history view, animation/accent settings. |

---

## The Full Experience

Roulette is one piece of a larger ecosystem. If you want to experience what these tools can really do when paired with handcrafted characters, deep worldbuilding, and a curated community, check out:

**Timeless Tavern** — a SillyTavern instance hosted by me, Hyperion. Multi-user, multi-world, and running on a prompt architecture that goes well beyond what's published here. Access is through the [**Discord**](https://discord.gg/therealhype).

**HYPERCODE** — my premium roleplay system prompt framework. Drop-in replacement for whatever you're running now; pairs naturally with Roulette. [GitHub →](https://github.com/hype-hosting/HYPERCODE)

## Other Ways to Connect

- **Discord** — [Hype Discord](https://discord.gg/therealhype) — Community, support, and access to Timeless Tavern.
- **Ko-fi** — [ko-fi.com/hype](https://ko-fi.com/hype) — Support the work. Memberships and commissions available.
- **The Hyperium** — [Substack](https://hyperionblackthorne.substack.com) — Writing, worldbuilding, and studio updates.
- **Tumblr** — [@hyperionblackthorne](https://hyperionblackthorne.tumblr.com) — AI art and dark aesthetic.

---

## License

Roulette is released under [AGPL-3.0](./LICENSE) — the same license as SillyTavern. You're free to use, share, and adapt it; derivative works distributed publicly must remain open under the same terms. See the license file for full terms.

## Contributing

Found a bug? Have a recipe that should be in the README? Open an issue or submit a PR. Community contributions that improve the framework — especially additional recipes for common rotation patterns — are welcome.

If you build something cool with Roulette, I'd love to hear about it. Drop into the [Discord](https://discord.gg/therealhype) and share.

---

<p align="center">
  <a href="https://ko-fi.com/hype"><img src="https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white&style=for-the-badge" alt="Support on Ko-fi"></a>
  &nbsp;&nbsp;
  <a href="https://discord.gg/therealhype"><img src="https://img.shields.io/badge/Join%20the-Discord-5865F2?logo=discord&logoColor=white&style=for-the-badge" alt="Join the Discord"></a>
</p>

<p align="center"><em>Crafted by Hyperion</em></p>
