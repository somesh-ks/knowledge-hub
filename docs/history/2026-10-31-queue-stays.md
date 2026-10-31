# 2026-10-31: the queue keeps what played, and a tap plays in place (D277)

The owner's report: a tap on a queued item "resets everything and clears the queue"; items vanish from the queue as they finish; jumping to the third item makes the bar disappear and come back. He chose the YouTube Music model (the full list stays).

- Cause: `playQueue.started` removed each item as it began, so any jump or finish shortened the list. `playQueueItem` also collapsed the sheet and navigated to the item's page, which took the bar down between the two items. Neither was reproduced as a bug on main or production in isolation (a stale tab after a deploy was the likeliest cause of the "reset"); the design itself was what he did not want.
- Change: `PlayQueue` gained played and current beside upcoming (`startItem`); `playQueueItem` loads the item into the one store and audio element (`queueMeta.ts` keeps each read page's digest); `queuePrefetch.ts` warms the first 512 KB of the next three finished items; Up next draws played rows (muted), the current row (accent) and the queue.
- Checked: unit tests for the pointer rule and the stored history; a player journey that jumps to the third item and asserts the bar never hides, the page stays, one audio element and the played rows stay. Not checked: a real phone; the cache hit of a later play on the Blob host.
- Two older player journeys asserted the page follows the playing item; they now assert the item plays.
