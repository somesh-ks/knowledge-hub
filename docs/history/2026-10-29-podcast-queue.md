# 2026-10-29: the podcast queue

The owner's queue plan, after the generations list (D208): what is being made shows as a browser lists downloads, only a Catch up or a regeneration, only while it is made, and the percent inside a ring.

## What was built

- PR A (#412): `GenerationRow` gained `kind` and `target` (from the run's title); `lib/queueNames.ts` names a row (`Catch up · 7 Oct`, `Weekly podcast · W24`, a start time only when two names match; the browser's zone); `lib/queuePercent.ts` is the share of expected time, weighed by stage length.
- The queue: `Queue.astro` (the dock, the popover, the row template, every word as a data attribute), `scripts/queue.ts` (one list drawn into both, polling only while something shows), `scripts/queueEntry.ts` (loaded when this browser has a run on record or the popover opens), `styles/queue.css`, and a row at the foot of the side column (`AppNav.astro`, `shell.css`). `runStatus.ts` keeps the record and the polling; its card, and `GenerationsMenu`, `generations.css`, `scripts/generations.ts`, are gone.
- A run that ends well leaves; the sheets island's toast (`runEndToast.ts`) says so with Open, and a started run now wakes that island.
- Tests: `e2e/queue.spec.ts` replaces `generations.spec.ts`; the run specs read the queue's rows and the toast; `fixtures.ts` answers `/api/generations` with none unless a test says otherwise.

## Decisions

[D216](../decisions/settings-and-create.md).

## Not verified

The queue against a real run (the percent over time, Cancel on GitHub, the toast on a phone), and a run of another device while this one has nothing on record.
