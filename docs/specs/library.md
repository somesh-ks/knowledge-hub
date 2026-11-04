# Library

What it does now. Reasons: D44, D59, D60, D77, D78, D88, D97, D104, D109, D127; history: docs/history/.

## Requirements

### Latest and briefing pages
- The first destination is called Latest; its id stays `today`. Destinations: Latest, Library, Catch up, Settings.
- No banner says how old a briefing is; offline is the one device banner.
- Every briefing has Share, Regenerate and Delete in its More menu (D104); a podcast page's More menu also offers Download and Add to queue (D214). Share is a secondary icon button (a circle on the select's fill) after Play (D219). Regenerate replaces that digest over its own window (`singularity run --replace`); Delete removes the digest and its timeline (`singularity run --delete`). Both go through `run.yml` and `/api/generate`. Today's Regenerate takes feedback for the writer and makes a new digest, not a replacement (D103).
- Regenerate chooses the topics again and takes comments, for an episode and a briefing (D109). A briefing's also takes a Length (Usual, 3, 5, 10 or 15 min). Usual sends no override and keeps the run's own sizing (the schedule's, or none for an on-demand run); the others size the run to that length (D207).
- Each story has like, dislike and "Stop hearing from" controls.
- The hero Play chip and the floating Play show resume or the length, never Played (D348); the cards and the page subtitle show played and downloaded marks (D97, see player.md).

### Episode pages
- An episode's menu offers Share, Regenerate and Delete (D88, D44). Both actions go through `/api/podcast` and `podcast.yml`.
- Scenario: WHEN an episode is deleted THEN it is hidden at once on the device that asked, while the workflow and the redeploy finish.
- A day's Catch ups are one album (D219): a select of "Catch up at 14" names (the start hour in the browser's zone) stands before Play when the day has two or more; choosing one opens its page. The hero's row scrolls sideways when select, Play and Share do not fit.
- A section's stories sit in one card under the section's header, on every podcast page. A downloaded page ends its facts line with a check circle and "Downloaded".
- An episode page shows Highlights with links, not the script: a briefing's summary where the story is in one, else what the hosts said without segues and questions.

### Library list
- Three single-select filter chips by kind: Daily, Weekly, Catch up (everything made on request, D125). None ticked means all.
- A card has one facts line, the same for every kind: the kind, then how many stories ("Daily · 12 stories", "Catch up · 5 stories"). The length is not on it (owner, 2026-11-02: too heavy). The Library, the list and the gallery, and Today's shelf say the same line at every width.
- Search finds a date in any form and searches inside episode scripts. Search, filter and order stay in the address.
- A card marks what this device holds, after its facts line and never in words (D348): a grey download-arrow circle once it is saved offline (owner, 2026-11-03: grey, not blue, so it does not draw the eye) (`CardMarks.astro`, `.status-mark`); a half-heard one shows its bar over the cover (`cardProgress.ts`); a finished one shows nothing, the podcast page says Played. Library list and gallery, Favorites and the Earlier shelf on Latest have it; Downloads does not (every row is saved). A podcast page's subtitle says the same as mark and word (`HeroMarks.astro`).
- Every podcast sheet (a card's ⋮ and long press, a podcast page's ⋮, Downloads, Favorites, a queue row) lists its actions in one order, `lib/podcastActions.ts`: Add to favorites, Add to queue, Share, Download, Regenerate, Go to podcast, Stop sharing, Delete; a page's ⋮ opens its card's sheet, and only a long sheet shows the first three as tiles (D369). A podcast page has a heart after Play (D365); Settings > Favorites lists what this device keeps (`player/core/saved.ts`). Settings > Downloads opens a row's sheet by a hold only; a swipe removes a download after a confirm.
- The Library opens as a List; the Gallery is the second choice (the switch lists List first) and is remembered on this device. `libraryView.ts` sets the saved view at every swap, before the page's own script runs, and draws a gallery's cards for two frames on a move back so the saved scroll is not cut short. Settings > Downloads and Favorites are always lists and never read the key. The Library has a play button on covers. Sort is a drawn select, absent on a phone (below 40rem), where the chips and the view switch share one line (chips scroll at 360px).
- In the List view each month has a small muted label ("October 2026", D288) that sticks under the top chrome; labels show for Newest and Oldest first, not Longest, and a month with nothing on show has none. From 80rem the rows run two across; below it, and on a phone, one column.
- Cards off screen use `content-visibility`. Going back to a scrolled gallery draws every card for two frames so each remembers its height and the saved offset is not cut short (`libraryView.ts`).

### Row menu and downloads (D127)
- Each row has a three-dots menu (`LibraryItemMenu.astro`, `libraryMenu.ts`; on a touch screen the dots are hidden and a 450 ms hold on the card opens it, D264, `cardHold.ts`): Download or Remove download, Add to queue, Regenerate, Share (the system sheet on a touch screen, the share dialog on desktop and wherever the sheet is missing), and Delete where the page allows it.
- Download stores the audio (a briefing's file; an episode's every pre-narrated turn, its marks and its `/api/narrate` lookup), the page, covers and scripts in Cache Storage `singularity-audio-v1`, no cap, nothing evicted (`lib/downloads.ts`, `libraryDownloads.ts`); Settings > Downloads lists, searches (from 8) and removes them (D281, `downloadsPage.ts`). An episode with a turn not stored says "Not ready offline yet".
- The three dots sit at the card's top right (a surface disc over the art) and do not move on press; no icon button scales or moves its glyph on press. On a phone the menu is a bottom sheet (SheetHeader and a scrim); from 40rem it is the popover. Every item has an outline icon (Share is the arrow).
- A downloaded briefing's Play chip works offline: it is shut offline only when its audio is not saved (`readerSync.ts` reads `singularity-audio-v1`).
- A downloaded card shows the arrow-line-down (a flat line under the arrow, no cup) in a grey circle after its facts, with "Downloaded" as hidden text. The mark is `CardMarks.astro` and shows on the card's `data-downloaded`.

### Floating button
- A toast sits at the bottom above the bar and the floating button rises by its height while it shows (`--fab-lift`).
- On a phone the floating button is Catch up on the Library alone (D60), extended (plus and words) at the top and while scrolling up, folded while scrolling down.
- Today, older briefings and episodes hold Play there ("Play · 5 min"), only once the hero's Play has scrolled away (D77), and it steps aside once the bar holds it (D59, D60). A Today with no briefing has none.
- Pressing the tab of the page you are on scrolls it to the top.
- Every page can scroll its last control clear of the floating button.

## Code
- `apps/web/src/pages/library.astro`
- `apps/web/src/scripts/libraryPage.ts`
- `apps/web/src/lib/libraryCard.ts`
- `apps/web/src/components/LibraryItemMenu.astro`
- `apps/web/src/scripts/libraryMenu.ts`, `libraryDownloads.ts`
- `apps/web/src/lib/downloads.ts`
- `apps/web/src/components/EpisodeActions.astro`
- `apps/web/src/scripts/episodeActions.ts`
- `apps/web/src/components/PlayFab.astro`
- `apps/web/src/pages/e/[id].astro`
