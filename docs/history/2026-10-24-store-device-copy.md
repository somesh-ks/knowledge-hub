# The store's answer kept on the device

The owner asked why Spotify's settings feel instant and how to make Dispatch professional. The answer for a one-user static site is not a database read per page but the pattern the big apps use at the edge: keep the user's data on the device and refresh it from the network. [D172](../decisions/store-and-ops.md#d172-a-settings-page-keeps-the-stores-last-answer-on-the-device) records the decision.

## What changed

`apps/web/src/scripts/configStoreRead.ts` writes every good store answer to `localStorage` and, when the store has not answered within 300 ms, resolves with that copy while the read goes on. The late answer updates what the next read sees and the copy for the next page; a failed read leaves the copy standing. Pages did not change: they still `await loadStore()` once and lay the result over the build.

## Checked

- Unit: a slow store answers from the copy, the late answer replaces it, a quick store wins over the copy, a copy from another build is ignored and a failed read keeps the last good answer (`configStoreRead.test.ts`, module state reset per test).
- Browser: the topics page journey with the store on now ends with a source added on another device, read once, then the store down: the page still shows it (`topics.spec.ts`).

## Also found

The switch-on itself is well prepared: `config_store_drift` warns only when a store edit predates a committed run and still differs, `site_behind` reads the paths Vercel deploys from `vercel.json` and skips bot commits, and `ignoreCommand` already drops a state-only commit's deploy. With the store on, a settings save makes no commit and no deploy; the next run's commit carries the copy.
