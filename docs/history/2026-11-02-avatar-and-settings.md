# The avatar, the profile page and Settings regrouped (D335)

Somesh asked for a theme-aware avatar top right, a page behind it with Downloads and Favorites, and Settings regrouped. The avatar was designed in a lab first (flat shapes with a face; his notes cut the gradient, the letter, the crescent, the sticker shadow, the blush and white Expressive eyes) and built as a design-system part in #589 (D326). The app side is one pull request stacked on it.

What changed: the avatar is the right end of the app bar and the top right of a wide screen (`AccountSlot`, two copies, one per layout), its shape follows the mood's `--av-shapes` token and the reader's pick, and it reacts to what the shell already says (`data-offline`, `data-run`, `data-player-state`, the `singularity:sound` and `singularity:saved` events). `/profile` holds the avatar, the picker, Downloads and Saved. Settings became Podcast settings, App settings and About. Sound and voice merged the old sounds and voice pages and took Autoplay and Default speed, which the owner has not yet confirmed (a card is open). `/settings/preferences` kept its route and became Structure alone; the source-type sliders and `WeightRow` were removed, the mix code on the server stays.

Tests rewritten for the moved controls: `settings.spec.ts`, `theme.spec.ts`, `podcast.spec.ts`, `settingsPages.spec.ts`, `layout.spec.ts`, `libraryMenu.spec.ts`, `uiSounds.spec.ts`, and the `preferences` unit test (one new field).

Not done: Saved becomes Favorites after #599 merges (copy only, route kept), and Style becomes Mood in code and storage (D327) as the last commit. Sign-in waits for Google auth.
