# Roulette — manual testing checklist

These walkthrough steps verify each v1 acceptance criterion in a live SillyTavern. Run before tagging a v1 release. Each section maps 1-to-1 with the acceptance criteria in `CLAUDE.md`.

## Setup

1. Install SillyTavern 1.12+ and start it.
2. Define at least three connection profiles in **Connection Profiles** (any three providers/models — they're labels for these tests). Suggested names: `A`, `B`, `C`.
3. Install Roulette via **Extensions → Install Extension → Install from URL** with this repository's URL.
4. Hard-refresh the browser (`Cmd-Shift-R` / `Ctrl-Shift-R`) to bypass any stale `manifest.json` cache.
5. Open DevTools Console. You should see seven `[Roulette] ...` log lines ending with `init() complete`. No red errors anywhere.

If init never logs, see `CLAUDE.md` → "Robustness pattern — self-invoke from top level".

---

## Criterion 1 — Install via Install from URL

**Pass:** Step 3 above completes without errors. Toast says `Extension 'Roulette' has been installed successfully!`.

## Criterion 2 — Roulette panel appears in the Extensions drawer

**Pass:** Open the wand → Extensions drawer (or the gear icon panel). A collapsible block titled **Roulette** is present.

## Criterion 3 — Create, save, activate a queue

1. In the Roulette block click **New queue**.
2. Name it `seq-test`. Mode: `Sequential`.
3. Slot 1: profile `A`, count fixed = 3.
4. Slot 2: profile `B`, count fixed = 2.
5. Slot 3: profile `C`, count fixed = 4.
6. Click **Save**. The queue appears in the list.
7. Pick `seq-test` from the start dropdown, click **Start**.

**Pass:** Pill changes from dimmed to active and reads `seq-test · A · 3`.

## Criterion 4 — Sequential rotation produces correct sequence

Continuing from C3.

1. Send 9 normal user messages.
2. Before each AI generation, glance at ST's connection-profile selector (top of API panel).

**Pass:** The selector shows the sequence `A, A, A, B, B, C, C, C, C` across the 9 generations. The pill counter ticks `3 → 2 → 1` then resets to `2 → 1` then `4 → 3 → 2 → 1`.

## Criterion 5 — Swiping does not advance the counter

1. With rotation active and counter at e.g. `2 left`, **swipe** the last AI message (use the swipe arrows on the message — generates a new variant).

**Pass:** Counter stays at `2 left`. Profile does not change.

## Criterion 6 — Regenerating does not advance the counter

1. With rotation active, click **Regenerate** on the last AI message.

**Pass:** Counter stays the same. Profile does not change.

## Criterion 7 — Weighted-random distribution

1. Create a queue `wr-test`, mode **Weighted random**, three slots all with weight `1`. Run length: fixed `1`. No-repeat-in-row: **off** for this test.
2. Activate it.
3. Send 100+ normal messages (or use a script). Watch the pill cycle.
4. After 100, sample the per-profile counts mentally — each should be roughly 33 ± 6.

**Pass:** Across 100 picks, no profile is conspicuously over- or under-represented. (For a precise test, run the offline math sanity script in this repo's history — it confirms 33.3% ± 0.2pp over 100k.)

## Criterion 8 — `noRepeatInRow` holds

1. Edit `wr-test`: enable **Don't repeat the same profile twice in a row**. Save. Restart rotation.
2. Send 50+ messages, watching the pill.

**Pass:** The profile name in the pill is never the same on two consecutive generations.

## Criterion 9 — Per-chat state independence

1. With `seq-test` running on Chat A, switch to a different chat (Chat B).
2. In Chat B, the pill should be dimmed (rotation off).
3. Start `wr-test` on Chat B.
4. Switch back to Chat A.

**Pass:** Chat A still shows `seq-test` running with its own counter; Chat B shows `wr-test`. State did not bleed between chats.

## Criterion 10 — Manual override pauses rotation

1. With rotation active, manually pick a different connection profile from ST's selector.

**Pass:** Pill changes to indicate `paused` (text includes "paused"). The status block in the Extensions drawer also shows `(paused: manual override)`. A **Resume** button is visible (in the popover and the settings block).

2. Click **Resume**.

**Pass:** Pill returns to active state. Next generation uses the slot's profile.

## Criterion 11 — Profile-deletion error path

1. Activate a sequential queue with three slots `A, B, C`.
2. **Delete profile B** in ST's Connection Profiles UI.
3. In the chat, exhaust slot A's counter (send the configured number of messages).
4. On the boundary, Roulette should attempt B → fail → skip to C.

**Pass:** Console logs a warning, profile selector skips to C, rotation continues normally. If you also delete `C` and `A` mid-run such that 3 consecutive switches fail, a toast surfaces and rotation halts.

## Criterion 12 — Status indicator updates within one frame

Subjective: with rotation active and counter `> 1`, send a message; the pill counter ticks down visibly without lag perceptible to the eye.

**Pass:** No noticeable delay between message receipt and counter update.

## Criterion 13 — Slash commands

In the chat input, type each command:

- `/roulette-status` → echoes `Roulette: off` or `Roulette: <queue> · <profile> · N left`.
- `/roulette-start seq-test` → activates `seq-test`. Pill becomes active.
- `/roulette-skip` → forces an immediate slot advance. Pill profile changes; counter resets to the new slot's count.
- `/roulette-stop` → deactivates. Pill dims.
- `/roulette-bind seq-test` → binds the current character. Echoes `seq-test`.
- `/roulette-unbind` → removes it. Echoes the queue name that was unbound.

**Pass:** All six commands behave as described, with no console errors.

## Criterion 14 — No console errors

Use Roulette normally for 5–10 minutes (start, stop, swipe, regen, switch chats, delete profile, manual override, resume).

**Pass:** No red errors in the DevTools Console. Warnings related to ST itself (not Roulette) are acceptable. Any `[Roulette] ...` warnings should be intentional (e.g. profile-skipped on deletion).

## Criterion 15 — Light + dark theme

Deferred to the v1 release styling pass. The current scaffolded styles use ST CSS variables (`--SmartThemeBodyColor`, `--SmartThemeBlurTintColor`, `--SmartThemeBorderColor`) so they should at minimum be readable in both, but no manual audit has been done yet.

## Criterion 16 — Per-character binding auto-starts

Requires two character cards (call them **Alice** and **Bob**) and two queues.

1. Open Alice's chat. In the modal's **Chamber** tab, set **Auto-start for Alice** to `seq-test`.
   - Rotation should start immediately — the profile switches and the pill goes active.
2. Switch to Bob's chat (no binding). Rotation should be off.
3. Switch back to Alice, into a **new** chat.
   - `seq-test` starts on its own before the first generation.

**Pass:** Alice's chats auto-start `seq-test`; Bob's don't.

## Criterion 17 — Bindings never clobber or resurrect a rotation

The two rules that keep auto-start out of the user's way:

1. **Running rotation wins.** In an Alice chat, `/roulette-start other-queue`.
   Switch away and back. It must still be `other-queue`, not `seq-test`.
2. **A stop sticks.** In an Alice chat, press **Stop**. Switch away and back.
   Rotation must stay off — the binding must not restart it.

**Pass:** Neither rule is violated. (Both are also covered by `npm test`.)

## Criterion 18 — Binding lifecycle

1. Bind Alice to a queue, then **delete that queue** in the Queues tab.
   Reopen Alice's chat — no rotation starts, no console error, and the Chamber
   dropdown reads "Nothing".
2. Bind Alice to a queue, then **rename Alice** in ST. Reopen her chat —
   the binding still applies under her new name.
3. Bind Alice, then **delete Alice**. The queue card's binding count drops.

**Pass:** No orphaned bindings, no errors.

## Criterion 19 — Group chats are inert

Open a group chat.

- The Chamber tab's **Auto-start for…** row is hidden entirely.
- `/roulette-bind seq-test` warns that bindings don't apply to group chats.
- No rotation auto-starts, regardless of member bindings.

**Pass:** Bindings have no effect in groups, and say so when asked.

## Criterion 20 — Queue-card character picker

In the Queues tab, click the masks icon on a queue card.

- Every character is listed, filterable by the search box.
- Characters bound to a *different* queue show a "currently &lt;queue&gt;" chip.
- Ticking one and saving rebinds it; the card's count chip updates.

**Pass:** Bindings round-trip correctly and conflicts are visible before saving.

---

## Automated coverage

`npm test` (node 18+, no dependencies) runs `tests/rotation.test.mjs` over the
pure core: slot sequencing, `noRepeatInRow`, weighted distribution, the
generation-type filter, and the binding auto-activation precedence rules.
It replaces hand-walking criteria 4, 7, 8 and the rule-checks in 17 — the
criteria above remain the manual check that the wiring around them is right.

This runs automatically on GitHub for every pull request (see
`.github/workflows/test.yml`), so a red cross on a PR means the scheduling
core broke.

---

## Reporting

For each section: record `pass / fail / notes` in a copy of this file. File any failure as a GitHub issue with:

- Steps run
- Expected vs observed
- Browser + ST version
- Relevant console output
