# Experiments page

2026-10-30. The owner asked for one admin page listing every experimental feature, each with a switch that works without a deploy, plus what a shadow run would have added.

## What happened

Three PRs, in order: the engine reads switches from Neon and caches them per run (#459); the admin page has a toggle and Promote, each behind a confirm dialog with an Undo snackbar (#461); shadow rows show "+N stories this week" from a new `experiment_hits` table (#470). The owner asked that a dialog's filled button hug its label; that went in as its own design-system PR (#462), which he merged by hand.

## Worth knowing

- Writes are serialized in the page, so a fast toggle and Undo cannot cross. Un-promoting only updates an existing row.
- A failed count read still returns the switches; a failed count save logs and never costs a run. Counts are recorded only with the store on and not on a dry run.
- `main` went red mid-review because #451 landed after D253's debt-list test; #472 fixed it with test data only. The branch merged `main` for the fix rather than editing the test.
- Not verified: the admin function and the write stage against Neon. The state doc line holds the closing condition.
