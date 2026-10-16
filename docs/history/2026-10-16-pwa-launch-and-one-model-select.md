# One model select, Android bars, a launch screen and a playing light

2026-10-16. The owner asked for one model drop-down upfront in Settings, a launch animation for the installed app in both themes, a light animation on the album art while playing, and an Android navigation bar that stops hiding its buttons and follows the theme; then for an audit of the app as a PWA and of its delight (D123).

- The white bar: Chromium paints an installed app's navigation bar in the manifest's theme_color (WebAppNavigationBarThemeColor) and freezes it at install; Chrome 128 dropped dark manifest colours, so no per-theme value exists. The manifest now names no colour and Android follows the system theme. Found through two open-source fixes of the same symptom and the Chromium commit; not reproducible in a desktop browser.
- The model select was built by a worker in a worktree; the worktree's `node_modules` link came along in its commit, and merging it replaced the real ignored folder (learnings, 2026-10-16).
- The launch screen and the glow were judged from CDP screencasts frame by frame; the standalone rule was switched on in the recorder by rewriting its media text, since headless Chromium cannot emulate display-mode.
