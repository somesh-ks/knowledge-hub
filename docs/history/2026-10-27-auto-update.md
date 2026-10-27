# 2026-10-27: a deploy loads itself

The owner's goal: the app always gets the latest version without a refresh or a "New version available" snack bar.

- **What changed.** `scripts/serviceWorker.ts` no longer sends a toast. When `/build.json` names a newer build it reloads the page once `canReloadNow` holds (no audio playing or loading, no dialog, sheet or toast open, no focused or edited text field), retrying every 5 s, on `astro:page-load` and when the page hides. `claimApply` stops a third load for one build in a tab. Decision: D202, amending D146.
- **A real bug found on the way.** The check compared `/build.json` with the head meta read at check time, but every in-app move swaps that meta for the new page's. After one move the page looked current while the bundle was old, so the toast never showed. The build is now read once in `app.ts` and passed to `registerServiceWorker`.
- **Why the guards.** D146 removed the earlier automatic reload because it threw away typing, an Undo and open sheets. The guards are those cases, kept as one tested function.
- **Verified.** Unit tests for `canReloadNow` and `claimApply`; `serviceWorker.spec.ts` deploy journey rewritten (a draft in a textarea holds the page, removing it lets the deploy load, no prompt appears); full file passes; `astro build` and the bundle budget pass. Not run here: the other browser suites, `astro check` (the Node here is too old, tsc passes), and a real phone.
