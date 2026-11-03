# 2026-11-02: pages arrive from the side of the tab you came from (D341)

The owner asked for a better page transition: a fluid move from the side that shows which tab you came from on a phone, and another way on desktop. Two drafts: the first kept a copy of the old page under the new one (blank frame in the frame-by-frame check, a clone for a move made tens of times a day) and was rejected; the second draws only the new page, 36px to its side, on the drawer curve.

- Found on the way: the strong ease-out spends a 24px slide in 60 ms, so it was never seen; a fade under a slide left empty frames; `navSpeed.spec.ts` already held a tab move to 150 ms, so a tab move is 150 ms and only a drill is 250 ms.
- Also in it: the tapped Library card keeps its press until the page arrives (`data-pending`), which was the "two ripples" and the wait the owner saw on opening a podcast; #609 prefetches the cards in view, which cut the wait itself.
- Checked by stepping frames at 40 to 50 per second, not at speed.
