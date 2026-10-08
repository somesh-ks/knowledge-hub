# 2026-10-08: a day of owner notes, shipped in parallel

## What happened

The owner used the app on production all day and sent notes as they came, many through the Agentation toolbar. Seventeen pull requests went out (#17 to #33, then one final one for the player, the live stages and the interface sounds).

## Why the work changed shape

The first half of the day went serially and slowly: one player change waited behind a 42 minute browser suite and a baseline comparison, while small notes queued. The owner said so ("run parallel cheaper subagents if needed. I want faster throughput"). From then on each batch of notes went to a `dispatch-worker` in its own worktree with its own files and ports, four at a time, and the main thread only merged, checked the stack and decided.

## Decisions made on the way

- The first-load JavaScript guard moved from 102 to 104 KB in two steps. Reading pages are at about 102; only the Topics and Sources pages go over 103, because they carry their editor. Loading that editor on first use is the way back.
- Prewarming the first audio segments on page open was chosen over streaming for the wait before the first sound: it is small, and it could ship the same day. Streaming waits for a measurement.
- The cover no longer flies between the bar and the open player, and the bar carries the only timeline on wide screens. The owner asked for both; they also removed the most fragile code in the player.
- The two hosts are Ada and Leo everywhere a speaker is shown. The writer's prompt does not name them yet.
- Episode stages stay coarse until the podcast command is split into phases; nothing is invented to fill the gap.

## What went wrong

- A cleanup instruction given to a worker deleted part of the main checkout's `node_modules` through junctions. Repaired; `docs/learnings.md` has the safe procedure, and the cleanup script written afterwards never follows a link.
- A dev server left running since morning served broken islands after the repair.
- The prewarm broke about 70 browser tests on its first try, because its background request reaches the test server.
- Branches that passed alone failed together twice (keyboard order and focus ring; a pinned cache version).
- Workers stop at 60 turns without a report about half the time, and one finished with a report that never arrived; its branch was read directly instead.

## Left open

See `docs/state.md`: word-level highlighting, finer episode stages, the bundle, the hosts' names in the prompt, and the owner's look at the live site.
