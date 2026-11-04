# Silent start on resume

2026-11-04. Thread: fix silent start when resuming a podcast. Decision D364.

## What was wrong

- On the owner's Xiaomi 17 (Chrome), a podcast played again after a while was silent for 1 to 2 s while the playhead moved.

## What was ruled out

- The player's clock is the element's own `currentTime`, read on each frame; nothing runs it ahead.
- The voice sample fade (#657) touches volume only around a sample.
- In Chromium, the real Opus m4a and MP3 of 2026-11-03 are audible from the first frame after the resume seek (captureStream into an analyser), at 1x and 1.5x, seek before or after `play()`.

## Cause (inferred)

- An idle phone output sleeps and a Bluetooth link drops its stream after a few seconds of quiet. Waking takes 1 to 2 s; the element consumes frames through it, so its clock runs while nothing is heard. A page cannot see the wake. Not reproduced on an Android phone.

## What changed

- Play after 10 s of quiet starts 2 s back (`playerStore.ts`), unless the listener moved the playhead, scrubbed or a voice sample resumed it.
