# 2026-11-01: digests and episodes leave git (D300 step 2b)

Somesh answered "Yes, prepare it now" to moving digests out of git, after step 2a (#565) gave the content store single-file writes. He also picked a Neon table over a second private Blob store for the weekly config snapshot (D311).

## What changed

- `Digests/` and `Podcasts/` are ignored and untracked. A job that reads or writes them runs `content pull --track` first (it copies the store in and records what it held in `.cache/content-baseline.json`) and `content push` after its git commit (it sends only the files this job added, rewrote or deleted, plus the small state files the site reads, which git still holds).
- The baseline is the switch: a checkout that never pulled cannot push, so a laptop run leaves the store alone, and `content sync` refuses a checkout with no digests when the store has some.
- `run.yml`, `podcast.yml` and `audio.yml` load before and save after; `health.yml` loads; `content.yml` is now the notifier alone. The site build pulls through `scripts/pullContent.ts` (skipped for fixtures and without a token).
- The weekly config snapshot is a row of `config_snapshots`; `BLOB_PRIVATE_READ_WRITE_TOKEN` is gone.

## Why this shape

The daily digest reaches the store before its git commit (the commit stage calls `publishContent`). Git records the run as published and moves the fetch window, so a digest that git has and the store lacks would be skipped by the next gate and lost; a digest the store has and git lacks is at worst written twice, and a failed save stops the commit. Everything else saves after the commit, in the workflow's Save content step: an episode or a state file lost to a failed save is made again by a retry. Audio saves whatever happened, because a timeline that never reaches the store is narrated and paid for twice. A state file is pushed only if the job changed it since the pull, so a slow job never puts older state over newer.

## Left out on purpose

`state/` stays in git (step 3). The write guard no longer sees digest edits, so its check that `publish` changes only a digest's audio field has nothing to read. One writer per path is still the bound from 2a. The test that rebuilt the spoken text of every committed digest went with the committed digests; the fixture test beside it covers the same rule.
