# 2026-10-21: the owner's backlog, built in parallel

Reasons: D126 to D130. Current behaviour: the player, library, settings, narration and navigation specs.

## What was asked

One long list from the owner: a chevron to close the player and Space to play and pause; the YouTube Music queue (Up next); a menu on every Library row with downloads for offline listening; episodes narrated ahead of the first Play; a Settings restructure (one voice pair, one global type mix, Sources and Preferences, Theme as a select, no breadcrumbs, no Weekly switch, Catch up as the name for on-request episodes); no Kimi models and a model list that tracks a benchmark.

## How it was split

Parallel workers, each in its own worktree on a branch from `integration`, each with a list of files it may touch and a budget of about 90 tool calls: player, Library menu and downloads with the service worker, engine pre-narration, settings pages, sources page, models, and this docs worker. A lead merged the branches into `integration` and ran the gate. One worktree started from an older base and had to be reset onto `integration` before anything was written. Workers that reached the cap without finishing were re-briefed with a smaller piece.

## What review caught

- The topics tab strip widened the page, and Chrome zoomed out: the grid column needed `minmax(0, 1fr)`.
- The Add source panel's rows were cramped; fixing them one by one led to the 8pt spacing system (its own decision).
- Space reopened the three-dots menu, because the menu took focus back when it closed from a tap elsewhere.

## Unverified

- Download and offline Play on a real phone, against the Blob host's CORS.
- Queue drag and pull gestures on a real phone.
- Episode pre-narration's first live run, after the `podcast.yml` change (a separate PR the owner merges by hand) lands. Owner action: set the GitHub variable `SPEECHIFY_VOICE_ID_B` to match Vercel's.
- `?view=preferences` may flash Sources on load.
- The weekly model check (Mondays 08:52 Europe/Stockholm) was created without connectors; its first run shows whether it can browse and open PRs.
