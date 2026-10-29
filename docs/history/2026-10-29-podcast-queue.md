# 2026-10-29: the podcast queue

The owner's queue plan, after the generations list (D208): what is being made shows as a browser lists downloads, only a Catch up or a regeneration, only while it is made, and the percent inside a ring.

## What was built

- PR A (#412): `GenerationRow` gained `kind` and `target` (from the run's title); `lib/queueNames.ts` names a row (`Catch up · 7 Oct`, `Weekly podcast · W24`, a start time only when two names match; the browser's zone); `lib/queuePercent.ts` is the share of expected time, weighed by stage length.
- The queue: `Queue.astro` (the dock, the popover, the row template, every word as a data attribute), `scripts/queue.ts` (one list drawn into both, polling only while something shows), `scripts/queueEntry.ts` (loaded when this browser has a run on record or the popover opens), `styles/queue.css`, and a row at the foot of the side column (`AppNav.astro`, `shell.css`). `runStatus.ts` keeps the record and the polling; its card, and `GenerationsMenu`, `generations.css`, `scripts/generations.ts`, are gone.
- First a run that ended well left and a toast with Open said so; the owner then asked for the opposite (same day): a run that ended stays for the day (`lib/queueDay.ts`, written by `runStatus.ts` when a run ends), a podcast made turns its ring into Start listening and the toast is gone (`runEndToast.ts` keeps only a failure under the open player). The ring is `QueueRing.astro`, and the stage icons morph by cross-fade.
- Second round (same day): the head always says "Podcast queue" with a small ring (a check or an alert once over); a row says the time first and shows the stage only as an icon at its end; a regeneration is marked "(Regeneration)"; Clear queue and the stage words went; a failed run's Details (`scripts/queueDetails.ts`) is a dialog with what went wrong and a snippet to copy.
- Third round (same day): the ring is small with no percent and the rounded time under it; the line under the name is the stage; an X cancels; the stage icons, `lib/queueStage.ts`, "(Regeneration)" and the text Cancel are gone; Details says what to do.
- Tests: `e2e/queue.spec.ts` replaces `generations.spec.ts`; the run specs read the queue's rows and the toast; `fixtures.ts` answers `/api/generations` with none unless a test says otherwise.

## Decisions

[D231](../decisions/settings-and-create.md).

## Not verified

The queue against a real run (the percent over time, Cancel on GitHub, the toast on a phone), and a run of another device while this one has nothing on record.
