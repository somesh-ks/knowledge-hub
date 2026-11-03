# 2026-11-03: the double ripple on a bottom tab tap (D347)

The owner saw two ripples on every bottom tab. Three causes, found in this order: a grey pill under the wave (the press tone on the pill), the blue pill growing from the centre as the wave opened, and last the real one. The Ripple redrew the wave on the new bar after the page swap from a count of milliseconds played taken before it. The wave runs on the compositor and keeps playing during the swap while the page's clock stands still, so the redraw restarted behind and grew a second time. It showed more on a slower phone, which swaps for longer. The fix gives both animations the press's start time on the document clock (#629).

- Found by an Opus worker stepping a quick tap at every frame; two earlier fixes were real but smaller, and the test that passed with the bug read the same frozen clock. The test now compares the new wave's `startTime` with the old one's.
- Also in it (#627): a step into a deeper page (a briefing, an episode, a Settings page) rises 36px and Back drops it; a tab move takes 250 ms, up from 150 ms, at the owner's word.
- Order matters: a design-system file cannot ride in an app PR (the gate), so #629 merged first.
- Lesson: step a quick tap at full frame rate before saying a ripple is fixed.
