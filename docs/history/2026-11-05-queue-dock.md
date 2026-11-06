# Queue dock

2026-11-05. Thread: Up next and the podcast queue. PR #704. No new decision.

## What was wrong

- "Taking longer than usual" showed within seconds and the ring stalled at 30 to 50%.
- The shimmer restarted and looked glitchy.
- The opened dock moved the Catch up button; a drag on its head scrolled the page; the open and fold were jerky.

## Cause

- The engine times only its own work in a stage (Gathering 36 ms, cover 1 ms, Publishing 14 ms), not the workflow step around it. Used as the stage's usual length, every run was slow at once and the ring raced through those stages.
- `paintList` took every row out of the page and put it back on each poll, and a CSS animation restarts when its node is re-inserted.
- The dock's open height was added to the page's room (`--run-room`), so the button rose with the queue. The drawer curve starts at full speed.

## What changed

- `stageLengths` keeps the prior as a floor under the timed length; only a stage the engine timed can be slow; the slow note is a second line (`slowNote`).
- Rows move only when out of order; every shimmer starts on the document's clock (`shimmerClock.ts`).
- The dock is an overlay (the page keeps the folded row's room); the list shows 3.5 rows (owner's pick), with room under the last row and no shadow; open and fold use the spatial spring tokens, the fade an effects spring, the chevron the medium icon; the head shows no overall percent.
- A head drag no longer scrolls the page (`touch-action: none`, a non-passive touchmove).

## Not done

- The ring not reaching complete after every story is played: waiting for a screenshot of the stuck row.
- 41 s under the ring against 4:44 in the dock: kept (the number is the time left to make it, not the length).
- The head drag, the easing and the shimmer are unverified on his phone.
