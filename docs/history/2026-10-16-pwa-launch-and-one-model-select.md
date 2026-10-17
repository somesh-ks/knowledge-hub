# One model select, Android bars, a launch screen and a playing light

2026-10-16. The owner asked for one model drop-down upfront in Settings, a launch animation for the installed app in both themes, a light animation on the album art while playing, and an Android navigation bar that stops hiding its buttons and follows the theme; then for an audit of the app as a PWA and of its delight (D123).

- The white bar: Chromium paints an installed app's navigation bar in the manifest's theme_color (WebAppNavigationBarThemeColor) and freezes it at install; Chrome 128 dropped dark manifest colours, so no per-theme value exists. The manifest now names no colour and Android follows the system theme. Found through two open-source fixes of the same symptom and the Chromium commit; not reproducible in a desktop browser.
- The model select was built by a worker in a worktree; the worktree's `node_modules` link came along in its commit, and merging it replaced the real ignored folder (learnings, 2026-10-16).
- The launch screen and the glow were judged from CDP screencasts frame by frame; the standalone rule was switched on in the recorder by rewriting its media text, since headless Chromium cannot emulate display-mode.
- The audit was a read-only agent's checklist; two workers built its small findings in parallel on disjoint files (service worker and install; motion), merged here after review. The review caught one visual bug a worker's own screenshot had passed (the pressed vote), found by measuring the box.
- The full browser suites ran on the combined branch; three failures were specs left stale by #145, #152 and #153 (a cover image per theme, Delete only for on-demand briefings, the Create form's hidden messages) and were brought up to date.
- Also from the owner the same evening: "delete source button is unavailable on mobile" (there was none on any screen) and "the model text ... too dark in light mode".
