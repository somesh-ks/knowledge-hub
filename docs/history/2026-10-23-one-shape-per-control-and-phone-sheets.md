# One shape per control, and phone lists as sheets

2026-10-23. A cloud session on the owner's phone round, after a conversation about why a source delete is slow, why `/api/costs` is slow and why the design rules allow so many deviations.

## What the owner asked

- Dropdowns and chips with different radii "shouldn't be possible in a design system unless requested"; chips rounded; the topic page's segmented control, chips and search bar round and the same components as elsewhere.
- Some dropdowns flash blue on a phone and others do not; no flash.
- Most dropdowns on a phone should be bottom sheets.
- More left and right padding so the chevron lines up with the search bar on the Sources page and everywhere else.
- Switch on the Neon config store, so edits stop waiting on a workflow and a rebuild.

## What was built (D167)

- The three concentric overrides of 2026-10-22 went: `.card-group` chips and select values, the Costs card's chips (and their 8px chevron inset) and the topic panel's switch, field, Add and chips. Every chip, select chip, select value, segmented control and search field is a pill. Row tiles and buttons stay concentric; form text fields keep `--field-radius`.
- `select` and `input` lost the tap highlight in `foundations.css`; the buttons already had.
- Under 40rem: a select's drawn list is a fixed bottom sheet through `::picker(select)` (CSS alone); the searchable picker sets `data-sheet` and clears its measured placement; the multi-select list is fixed in place and its card rises to `--z-sheet`. Scrims are a spread of the sheet's shadow.
- `.topics .row-action` and `.source-row` take 16px inline padding; the pulled-out chevron rule went.
- Screenshots before and after at 390 and 1280, light, with the open lists, drove each change.

## The second round (D168)

Asked while the suites ran: checks at the end of a sheet's rows; "New episode" renamed Catch up (the kind its episodes are filed under) on the floating button, the side column, the sheet, the Create page, the Library's empty state and the manifest shortcut; Latest's flame swapped for Phosphor's lightning in `tokens/glyphs.json` (`npm run glyphs`); a toast that swipes away sideways (`Toaster.tsx`: past 35% of its width or 0.6 px/ms; a swipe dismisses and never undoes; one phone test in `storyVotes.spec.ts` compares the box to itself after a short drag). The ledger gained section 11, the phone patterns, for agents.

## The third round (D169 to D171)

Eight more asks at once. Built: the app bar pinned on pages with a sticky block (`data-pins-bar`); the player's switch segmented at every width in a sticky bar; queue rows reordered by native drag and drop (a long press on a phone, a pull with a mouse), removed by a swipe left, with a dots menu for Move up, Move down and Remove (the handle and the cross went); every select a pill in forms too; section tabs 16px apart; the Costs card's chart/table glyph switch; the weight rows' stop names at the row's end; covers with a 0.16 chroma cap and a deeper, tinted light stock (D171, judged on `npm run covers:sheet`). Written, not built: the modular podcast structure (D170, [design](../design/podcast-structure.md)) with five questions for the owner. Checked: the live Analytics page loads ($0.43, 10 runs); the one path to "Unavailable" is a non-200 from `/api/costs`.

## The Neon switch-on

- The seed workflow ran its first time, as a dry run with replace: four rows differ from the committed files, the GitHub secret is set.
- Vercel holds the Neon integration's variables as `NEON_DATABASE_URL` and friends; nothing reads them, and there is no `DATABASE_URL`. The store, and the shared rate counter of D150, have therefore never run in production. Runbook 11.1 step 7 now says so. The switch-on waits on the owner: the Vercel `DATABASE_URL`, the GitHub variable (no API for it from here), then seed with replace, the two switches and a redeploy, in that order.
- 2026-10-24: the owner added `DATABASE_URL` on Vercel and, ahead of the order, the GitHub variable. The seed's dry run with replace still listed the four files, and the engine refuses the real replace while that variable is on (`config seed`, no `--force` from the workflow). No run read the store yet (the next is due 2026-10-26, and a run with stale rows would commit them over `config/`), so the owner clears the variable, the seed replaces, and the variable and Vercel's flag go on. `/api/config` answers 405 until the flag is on Vercel: expected, not a fault.
- The owner answered the five D170 questions the same day; the design holds them and D170 is accepted.

## What went wrong

- `::picker(select)::backdrop` fails the Astro build in lightningcss; found by the second build, not the design check.
- The topic page's `::picker` placement rule in `settings.css` outweighed the shared sheet rule by load order until it was scoped to desktop.
- Playwright in the container needs the preinstalled Chromium by path.
