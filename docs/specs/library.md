# Library

What it does now. Reasons: D44, D59, D60, D77, D78, D88, D97, D104, D109; history: docs/history/.

## Requirements

### Latest and briefing pages
- The first destination is called Latest; its id stays `today`. Destinations: Latest, Library, New episode, Settings.
- No banner says how old a briefing is; offline is the one device banner.
- The latest briefing's three-dots menu offers Share and New briefing; an older briefing has a Share button.
- Every briefing has Share, Regenerate and Delete in its More menu (D104). Regenerate replaces that digest over its own window (`dispatch run --replace`); Delete removes the digest and its timeline (`dispatch run --delete`). Both go through `run.yml` and `/api/generate`. Today's Regenerate takes feedback for the writer and makes a new digest, not a replacement (D103).
- Regenerate chooses the topics again and takes comments, for an episode and a briefing (D109).
- Each story has like, dislike and "Stop hearing from" controls.
- The hero Play chip, the floating Play and the cards show resume, played and heard state (D97, see player.md).

### Episode pages
- An episode's menu offers Share, Regenerate and Delete (D88, D44). Both actions go through `/api/podcast` and `podcast.yml`.
- Scenario: WHEN an episode is deleted THEN it is hidden at once on the device that asked, while the workflow and the redeploy finish.
- An episode page shows Highlights with links, not the script: a briefing's summary where the story is in one, else what the hosts said without segues and questions.

### Library list
- Three single-select filter chips by kind: Daily, Weekly, Catch up (everything made on request, D125). None ticked means all.
- A card has one facts line: kind, then contents, then length ("Daily · 12 stories · 8 min", "Discussion · 5 min").
- Search finds a date in any form and searches inside episode scripts. Search, filter and order stay in the address.
- A recording heard to its end says Played (D78).
- The Library has a List view and a play button on covers. Sort is a drawn select.
- Cards off screen use `content-visibility`.

### Floating button
- On a phone the floating button is New episode on the Library alone (D60), extended (plus and words) at the top and while scrolling up, folded while scrolling down.
- Today, older briefings and episodes hold Play there ("Play · 5 min"), only once the hero's Play has scrolled away (D77), and it steps aside once the bar holds it (D59, D60). A Today with no briefing has none.
- Pressing the tab of the page you are on scrolls it to the top.
- Every page can scroll its last control clear of the floating button.

## Code
- `apps/web/src/pages/library.astro`
- `apps/web/src/scripts/libraryPage.ts`
- `apps/web/src/lib/libraryCard.ts`
- `apps/web/src/components/EpisodeActions.astro`
- `apps/web/src/scripts/episodeActions.ts`
- `apps/web/src/components/PlayFab.astro`
- `apps/web/src/pages/e/[id].astro`
