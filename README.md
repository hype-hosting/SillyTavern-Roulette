# SillyTavern-Roulette

A SillyTavern extension that rotates between connection profiles during a chat — sequentially or by weighted random — so you can mix models, parameters, and providers without manually switching.

## Status

Pre-alpha. The repository is scaffolded but rotation logic is not yet implemented.

## What it does

You select multiple SillyTavern connection profiles, drop them into a "queue," set a rotation policy (sequential with fixed or ranged response counts, or weighted-random), and Roulette automatically switches the active connection profile as the chat proceeds. State is per-chat. A small status indicator surfaces the current profile and how many responses remain in the current slot.

Because the unit of rotation is the **connection profile**, Roulette doesn't need to know anything about individual providers, API endpoints, model names, or sampler parameters — that all lives in the profile itself. Roulette is a *scheduler* that calls `/profile <name>` at the right moments.

## Requirements

- SillyTavern 1.12+ (uses the Connection Manager / connection profiles API)
- At least two connection profiles defined in SillyTavern

## Install

In SillyTavern: **Extensions → Install Extension → Install from URL** and paste this repository's URL.

Manual install: clone into `data/<user>/extensions/SillyTavern-Roulette/` (per-user) or `public/scripts/extensions/third-party/SillyTavern-Roulette/` (global), then enable in the Extensions panel.

## Usage

Once usage is implemented this section will document queue creation, activation, and slash commands. For now, see [`CLAUDE.md`](./CLAUDE.md) for the full design spec.

## License

[AGPL-3.0](./LICENSE) — matches SillyTavern's license.
