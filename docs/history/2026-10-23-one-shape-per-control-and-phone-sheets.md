# One shape per control, and phone lists as sheets

2026-10-23. A cloud session on the owner's phone round, after a conversation about why a source delete is slow, why `/api/costs` is slow and why the design rules allow so many deviations.

## What the owner asked

- Dropdowns and chips with different radii "shouldn't be possible in a design system unless requested"; chips rounded; the topic page's segmented control, chips and search bar round and the same components as elsewhere.
- Some dropdowns flash blue on a phone and others do not; no flash.
- Most dropdowns on a phone should be bottom sheets.
- More left and right padding so the chevron lines up with the search bar on the Sources page and everywhere else.
- Switch on the Neon config store, so edits stop waiting on a workflow and a rebuild.

## What was built (D160)

- The three concentric overrides of 2026-10-22 went: `.card-group` chips and select values, the Costs card's chips (and their 8px chevron inset) and the topic panel's switch, field, Add and chips. Every chip, select chip, select value, segmented control and search field is a pill. Row tiles and buttons stay concentric; form text fields keep `--field-radius`.
- `select` and `input` lost the tap highlight in `foundations.css`; the buttons already had.
- Under 40rem: a select's drawn list is a fixed bottom sheet through `::picker(select)` (CSS alone); the searchable picker sets `data-sheet` and clears its measured placement; the multi-select list is fixed in place and its card rises to `--z-sheet`. Scrims are a spread of the sheet's shadow.
- `.topics .row-action` and `.source-row` take 16px inline padding; the pulled-out chevron rule went.
- Screenshots before and after at 390 and 1280, light, with the open lists, drove each change.

## The second round (D161)

Asked while the suites ran: checks at the end of a sheet's rows; "New episode" renamed Catch up (the kind its episodes are filed under) on the floating button, the side column, the sheet, the Create page, the Library's empty state and the manifest shortcut; Latest's flame swapped for Phosphor's lightning in `tokens/glyphs.json` (`npm run glyphs`); a toast that swipes away sideways (`Toaster.tsx`: past 35% of its width or 0.6 px/ms; a swipe dismisses and never undoes; one phone test in `storyVotes.spec.ts` compares the box to itself after a short drag). The ledger gained section 11, the phone patterns, for agents.

## The Neon switch-on

- The seed workflow ran its first time, as a dry run with replace: four rows differ from the committed files, the GitHub secret is set.
- Vercel holds the Neon integration's variables as `NEON_DATABASE_URL` and friends; nothing reads them, and there is no `DATABASE_URL`. The store, and the shared rate counter of D150, have therefore never run in production. Runbook 11.1 step 7 now says so. The switch-on waits on the owner: the Vercel `DATABASE_URL`, the GitHub variable (no API for it from here), then seed with replace, the two switches and a redeploy, in that order.

## What went wrong

- `::picker(select)::backdrop` fails the Astro build in lightningcss; found by the second build, not the design check.
- The topic page's `::picker` placement rule in `settings.css` outweighed the shared sheet rule by load order until it was scoped to desktop.
- Playwright in the container needs the preinstalled Chromium by path.
