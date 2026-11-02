# Catch up exit, full Regenerate, medium script (D323, D324)

After Generate the Catch up sheet closed in a flash and the queue bar was not there yet, so the screen jumped. The sheet now slides for the whole sheet duration and fades only at the end, and the queue bar rises after a 150 ms delay. The episode Regenerate dialog does the same through a `data-started` flag set before `close()`.

The briefing Regenerate was a bottom Drawer. The full variant (patched to the design-system pull request, which alone may change system stylesheets) is `SheetFrame` with `full`. `SheetFrame` has a `full` variant (phone full screen, right panel from 40rem, the button in a foot), so `GenerateSheet` could stay a Drawer instead of moving to the Astro Sheet. The Length control lost "Usual" and starts on the length the podcast aired at; the hero and Library card menus pass `data-minutes` for it.

Speed: tap to listenable episode was about 3 minutes (podcast job 64 s, audio job 83 s, content sync about 100 s after the run ends). The script step moved from high to medium effort. The workflow cuts need the owner's manual merge and went to the storage thread.

Not built: the Jev comment hints (relevant controls shown as the owner types a note). They exist nowhere in code, docs or decisions; a decision card is open. The comments field autofocus is fixed in the motion thread's pull request.

Tests: the Regenerate e2e asserts the length that starts and that Usual is gone; `regenLength.test.ts` covers the rounding.
