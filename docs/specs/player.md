# Player

What it does now. Reasons: D32, D50, D54, D59, D85, D86, D90, D92, D97 to D99, D101, D102, D107, D111, D126; history: docs/history/.

## Requirements

### Surface and bar
- The player is one surface from the bottom bar to a full page. The whole bar opens it; a drag, the bar, Back or Escape close it. Back closes the open player instead of leaving the page.
- The dock has a chevron beside volume from 64rem, none below (D102, D193). A "Close the player" chevron sits top left of the open player below 64rem (D126); from 64rem it shows only on keyboard focus. The open player has no drag handle and square top corners; the art keeps its room (D111). Bottom sheets have no grabber.
- The bar and the navigation share one fill (D86); below 64rem a hairline along the bar's bottom edge parts them (2026-11-02; none under the queue's dock). A phone's bar swipes between podcasts and shows the target, no Next (D343). The player is held by its bottom edge and is `100dvh` tall, so the bar, the navigation and the floating button move with the address bar as one.
- The app bar's Back goes back one entry.
- Below 64rem the bottom navigation slides away with the pull and stays above the rising page until gone; the bar's cover grows into the page's cover on the same progress (none from 64rem or under reduced motion; `core/coverMorph.ts`).
- Any Play (a cover, a page's chip, Start listening in the queue) starts the podcast in the player: below 64rem the player opens over the page, from 64rem only the bar changes to playing and stays shut (`core/openOnPhone.ts`). A story's play button and autoplay never open it.
- The playing cover lights the open player.
- The bar's title is the story's chapter (the writer's `chapter`, at most 5 words and 26 characters), so it fits a 360px phone; older stories show their headline. Under it: the clock, then the story's section ("0:02 / 0:36 · Top picks"), or what the recording is before story 1 and in an episode.
- The volume button holds the bar's right edge and its level opens to the left. The wide bar shows what is playing on the left, the transport in the centre and a volume slider that appears on hover or focus (D106).
- Only Play is in full ink in the player (D54). A button's glyph says what it does: refresh for Try again, replay for Play again.

### Open page and transport
- The open page: art at 40px, then title, story and source; the five transport controls on one axis with a speed pill under play on a phone.
- On a wide screen with a mouse (64rem) the bar keeps previous, play, next and the clock under the open page, and the page holds back ten, the speed and forward ten (D101, returns D90's split). On a touch screen from 40rem and on a narrower mouse window the bar under the open page shows only what is playing, so one Pause is on screen (D90, D92).
- The speed button reads a fixed five characters ("1.00x") so its label does not slide.
- The speed opens a slider from 0.5x to 2x in steps of 0.05, in a modal dialog (under the pill on a phone, above it with a mouse), with presets 1x, 1.25x, 1.5x and 2x. Any step is remembered; Preferences has a Default speed row (D193).
- The desktop bar's line has a notch at the playhead. Timeline markers are one small dot per story.
- Under the scrubber: time played left, the length right, never a minus (D350). The bubble and the bar's times hold still over a hidden copy of their widest time.
- Space plays and pauses on briefing and episode pages once the bar is there, unless focus is in a field, menu, dialog or slider (`playerKeys.ts`, D126); the hero's three-dots menu does not take focus when it closes from a tap elsewhere (`heroMenu.ts`). The first Play on a page with no audio starts by itself.
- The player's two views (below) are a tablist. The podcast page's section tabs at every width (D343), sticking under the status bar below 64rem. Switching keeps the scroll position.

### Stories and transcript
- The Stories view merges the chapters and the transcript. The story being read is open: its transcript shows with an episode's follow and word light. Every other story is a chapter row that starts it when tapped. Unlaid-out narration shows its script whole (`StoryList`, `core/storyTranscript.ts`).
- A briefing's transcript is what the host says of each story (from the digest's spoken version).
- Story rows show their start time, rising, and start there (D350); a story ends where the next starts (D346); previous and next step between them (D85, D90). Before story 1 (the rundown) Next goes to story 1, Previous to 0:00. A move made with the controls never scrolls the page (D92).
- The transcript is a plain reading column with one Tab stop: said words in full ink, the rest muted, the spoken word on a soft fill, from Speechify's word marks, with an estimate where a segment has none. "Back to now" is drawn over the whole list.

### Queue and Up next (D126)
- A play queue of ids (`singularity:queue` in localStorage, `core/playQueue.ts`) takes items from the Library menu's Add to queue (`singularity:queue-add`). When an item ends the first queued one starts. Rows (`QueueList`, `QueueRow`) move by their handle (Up and Down on it too); a swipe either way, or Delete on the handle, removes one over a red strip (D346). Below 64rem a row is one band to the screen's edges and a hold opens its menu as a sheet (D354).
- Up next plays top to bottom (D357): any row moves anywhere; rows above the playing one stay, muted, never autoplaying; changes glide. What played is kept (`singularity:queue-played`, 30 at most), not listed. A tap on a row plays it in place, the bar up (D277). The next three queued items with finished audio get their first 512 KB at idle.
- Up next is the player list's second view at every width (it stays selected when the item changes): the queue, or the next older item when the queue is empty. There is no peek strip and no pull-up queue sheet.
- Scenario: WHEN a recording has ended and there is something to offer THEN the view turns to Up next; Stories is a tap away. With autoplay on (default) the first suggestion starts when the queue is empty. Suggested stays under the queue: one added leaves it, a refill goes last, one removed is not offered again.

### Failure and memory
- A failure is told once, in the line under the title, and nothing below it moves.
- Scenario: WHEN Play is pressed in a failure and the page is scrolled past the line THEN the reason scrolls into view (D98, D99).
- Scenario: WHEN a refusal lands while the next file loads THEN it fails at that story's start; a press plays nothing of the story before it.
- Scenario: WHEN offline and Play is pressed THEN the reason repeats and nothing loads.
- A recording's position, whether it was heard to the end and which stories were heard (`singularity:resume|played|heard:<id>`) is read by one reader and shown alike on every chip, card and shelf, for stored and narrated audio (D97).
- Scenario: WHEN Play follows 10 s of quiet THEN it starts 2 s back, as a phone's output wakes late (D364); not after a quick pause, scrub or set place.
- A reload (deploy, refresh, a dropped tab) or a step through history restores the tab, not a new address: the track on the bar, paused at the kept place, the open player open again, silently (`sessionRestore.ts`). A deploy waits for the open player.
- Heard to its end, a recording shows Played in its subtitle, not on its card; the hero, floating and story Play never say it (D348, D351).
- Each story has like, dislike and "Stop hearing from" controls (see settings.md).

## Code
- `apps/web/src/player` (surface, bar, scrubber, transcript, speed)
- `apps/web/src/player/core/coverMorph.ts`
- `apps/web/src/player/core/resume.ts`
- `apps/web/src/player/core/sessionRestore.ts`
- `apps/web/src/player/core/playQueue.ts`
- `apps/web/src/player/UpNext.tsx`, `QueueSheet.tsx`
- `apps/web/src/player/core/playerSheet.ts`
- `apps/web/src/styles/player.css`
- `apps/web/src/components/StoryControls.astro`
