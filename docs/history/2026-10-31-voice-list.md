# 2026-10-31: the voice list item (D276)

The owner found the Podcast voice item out of step with the rest of the design language: a tonal Play disc beside a select whose value sat under its label, and names that could run long. He asked for mocks, then picked B5 after refining the title (name and flag only), the subtitle ("Gender, accent"), the Default form and the spacing after Play.

- Mocks: seven rounds laid over the real build at 390 and 1280, light and dark, in `/mnt/project-files/voice-list/` (A value row, B audition in the list, B2 Play left, B3 gender subtitle, B4 flag inline, B5 name-only titles, C list item).
- What shipped: the picker draws a voice item (`picker.ts`, `picker.css`); `fillVoiceSelect` supplies the title, subtitle and sample; the page row lost its Play; the Create chip and `voiceSamples.ts` are gone; Shift+Enter plays the highlighted voice.
- Found on the way: a list row's `min-block-size` made grid rows shrink in an overflowing list (fixed with `grid-auto-rows: max-content`); an open select on a Manage page sat 20px from the card edge on the right against 12px on top, because the value-select pull assumes a tile row (a Manage row sits at the full card padding).
- Checked: gate, unit, and the podcast, settings pages, create, design system, accessibility, keyboard, layout and rhythm browser suites at 390 and 1280. Not checked on a real phone: the sample audio.
