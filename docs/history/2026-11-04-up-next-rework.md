# Up next rework (2026-11-04)

D357 (amends D349). Somesh: no row could go above the playing one, adding from Suggested and removing a row jumped, and a swipe to remove never showed the red strip on his Xiaomi. PRs #659 and #672.

Order. The list plays top to bottom. Rows above the playing one are kept as `above` in `singularity:queue-played`, muted, and never start by themselves; `PlayQueue.arrange(order)` replaced `move` and `skip`.

Glides. `queueFlip.ts` reads each row's place when the queue changes, before React redraws, and moves it from there. The drop glide had never run on the site: the build writes `650ms` as `.65s` and `parseFloat` read 0.65 ms.

Swipe. `touch-action: pan-y` let Chrome take a slanted thumb start as a scroll and cancel the pointer; our tests swiped level. A non-passive `touchmove` holds the scroll until the press has a direction (6 px).

Suggested. A podcast removed from the queue stays out of Suggested and Autoplay until it is queued or played (`singularity:queue-removed`); new suggestions go at the end, never on top (`keepPlaces`).

Tabs. On a short phone the cover gives way so the Stories and Up next tabs show whole on the player's first screen (`--player-phone-rest`); a layout check fails if they drop below it.
