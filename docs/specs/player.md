# Player

What it does now. Reasons: D32, D50, D54, D59, D85, D86, D90, D92, D97 to D99, D101, D102, D107, D111, D126; history: docs/history/.

## Requirements

### Surface and bar
- The player is one surface from the bottom bar to a full page. The whole bar opens it; a drag, the bar, Back or Escape close it. Back closes the open player instead of leaving the page.
- The dock has a chevron beside volume from 64rem, none below (D102, D193). A "Close the player" chevron sits top left of the open player below 64rem (D126); from 64rem it shows only on keyboard focus. The open player has no drag handle, and its top corners are square at every point of its travel; the art keeps the room the handle took (D111). Bottom sheets have no grabber and square corners.
- The bar and the navigation are one tonal block (D86). The player is held by its bottom edge and is `100dvh` tall, so the bar, navigation and floating button move with the address bar as one.
- The app bar's Back goes back one entry.
- Below 64rem the bottom navigation slides away with the pull and stays above the rising page until gone; the bar's cover grows into the page's cover on the same progress (none from 64rem or under reduced motion; `core/coverMorph.ts`).
- The playing cover lights the open player.
- The bar's title is the story's chapter (at most 5 words and about 22 characters; the writer produces it as `chapter` on a digest item; a label over 26 characters or 5 words is dropped), so it fits a 360px phone; older stories show their headline. Under it: the clock, then the story's section ("0:02 / 0:36 · Top picks"), or what the recording is before story 1 and in an episode. There is no centre clock and no "Story N of M".
- The volume button holds the bar's right edge and its level opens to the left. The wide bar shows what is playing on the left, the transport in the centre and a volume slider that appears on hover or focus (D106).
- Only Play is in full ink in the player (D54). A button's glyph says what it does: refresh for Try again, replay for Play again.

### Open page and transport
- The open page: art at 40px, then title, story and source; the five transport controls on one axis with a speed pill under play on a phone.
- On a wide screen with a mouse (64rem) the bar keeps previous, play, next and the clock under the open page, and the page holds back ten, the speed and forward ten (D101, returns D90's split). On a touch screen from 40rem and on a narrower mouse window the bar under the open page shows only what is playing, so one Pause is on screen (D90, D92).
- The speed button reads a fixed five characters ("1.00x") so its label does not slide.
- The speed opens a slider from 0.5x to 2x in steps of 0.05, in a modal dialog (under the pill on a phone, above it with a mouse), with presets 1x, 1.25x, 1.5x and 2x. Any step is remembered; Preferences has a Default speed row (D193).
- The desktop bar's line has a notch at the playhead. Timeline markers are one small dot per story.
- The scrubber's time bubble and the bar's times hold still while the slider moves: each sits over a hidden copy of the widest time it can show, and the bubble moves in whole device pixels.
- Space plays and pauses on briefing and episode pages once the bar is there, unless focus is in a field, menu, dialog or slider (`playerKeys.ts`, D126); the hero's three-dots menu does not take focus when it closes from a tap elsewhere (`heroMenu.ts`). The first Play on a page with no audio starts by itself. Nothing is said under the play chip before audio exists.
- The player's two views (below) are a tablist. Below 64rem it is a full-bleed tab line like YouTube Music's (tabs share the width, a hairline under the row, an accent bar under the chosen tab) that stays under the status bar's room while the page scrolls; from 64rem it is the navigation segmented control (`.segmented-nav`, D132) above the list's column. Same markup either way (`ui/PlayerTabs.tsx`).

### Stories and transcript
- The Stories view merges the chapters and the transcript. The story being read is open: its transcript (headline in its row, the host's words under it) shows with the same follow and word light as an episode's. Every other story is a chapter row that starts that story when tapped, and the transcript moves to it. Before story 1 an episode's rundown shows its transcript above the rows. A recording whose narration is not laid out yet shows its script whole (`StoryList`, `core/storyTranscript.ts`).
- A briefing's transcript is what the host says of each story (from the digest's spoken version).
- Stories are timed rows that start the story; previous and next step between them (D85, D90). The rundown before story 1 is no story: Next goes to story 1, Previous to 0:00. A move made with the controls never scrolls the page (D92).
- The transcript is a plain reading column with one Tab stop: said words in full ink, the rest muted, the spoken word on a soft fill, from Speechify's word marks, with an estimate where a segment has none. The spoken word lights without lag. The highlight pauses while the host speaks words the page does not show (D107). "Back to now" is drawn over the whole list.

### Queue and Up next (D126)
- A play queue of ids (`singularity:queue` in localStorage, `core/playQueue.ts`) takes items from the Library menu's Add to queue (`singularity:queue-add`). When an item ends the first queued one starts. Rows (`QueueList`, `QueueRow`) reorder by dragging or from the row menu (D169).
- The list stays (D277): items that played stay above the one playing (`singularity:queue-played`, 30 at most), a tap on any row plays it in place with no page move and the bar stays up, and a tap on a played row plays it again and puts the later ones back to come. The next three queued items with finished audio have their first 512 KB fetched at idle.
- Scenario: WHEN the listener taps the third queued item THEN it plays at once, the page does not move, the bar never hides, and the two skipped items and the one that played stay listed.
- Up next is the second view of the player's list, on a phone and on a wide screen (it stays selected when the item changes): the queue, or the next older item when the queue is empty. There is no peek strip and no pull-up queue sheet.
- Scenario: WHEN a recording has ended and there is something to offer THEN the view turns to Up next; the listener can go back to Stories. With Podcast autoplay on (the default) the first suggested item starts by itself when the queue is empty (#334; D126 meant the queue only).

### Failure and memory
- A failure is told once, in the line under the title, and nothing below it moves.
- Scenario: WHEN Play is pressed in a failure and the page is scrolled past the line THEN the reason scrolls into view (D98, D99).
- Scenario: WHEN a refusal lands while the next file loads THEN it fails at that story's start; a press plays nothing of the story before it.
- Scenario: WHEN offline and Play is pressed THEN the reason repeats and nothing loads.
- A recording's position, whether it was heard to the end and which stories were heard (`singularity:resume:<id>`, `singularity:played:<id>`, `singularity:heard:<id>`) are read by one reader and shown the same on the hero chip, the floating Play, the Library's cards, the Earlier shelves and the story chips, for stored audio and for narration on Play (against the page's estimate) (D97).
- A recording heard to its end says Played; a played chip reads Play again under the pointer (D78, D106).
- Each story has like, dislike and "Stop hearing from" controls (see settings.md).

## Code
- `apps/web/src/player` (surface, bar, scrubber, transcript, speed)
- `apps/web/src/player/core/coverMorph.ts`
- `apps/web/src/player/core/resume.ts`
- `apps/web/src/player/core/playQueue.ts`
- `apps/web/src/player/UpNext.tsx`, `QueueSheet.tsx`
- `apps/web/src/player/core/playerSheet.ts`
- `apps/web/src/styles/player.css`
- `apps/web/src/components/StoryControls.astro`
