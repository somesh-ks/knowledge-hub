# Create

Catch up and custom episodes. What it does now. Reasons: D37, D43, D60, D66 to D68, D76, D82, D114; history: docs/history/.

## Requirements

### Form
- Catch up is the primary action (D76): a side button on wide screens, a floating button on phones, a panel for the form (full screen on a phone, a side panel on desktop) and a compact progress indicator.
- `/create` is the same form as a page under the Library, with Back to it.
- Fields: Title ("Optional" beside it), Categories (alphabetical), Max length, Look back. More options holds Format (Readout or Discussion, a segmented choice, no hint line), Voice or Voices (Primary and Secondary voice, each with a play button for its sample, dimmed while a voice has none, chosen from a searchable list with SVG flags) and Tone (Neutral or Energetic). Its line reads "Readout · Neutral tone" (D76, D114). The button reads "Generate catch up" (2026-10-25).
- Every episode is written for the owner; there is no General audience (D114).
- No topic limit in the form (a guard of 50 in `PODCAST_MAX_TOPICS`). The button reads "Generate • N mins".
- Create shows one chip list: Design, AI, Technology, Software Engineering, World, Business, Science, Culture, Sports, then the owner's topics; the first four are ticked. Release news (Launches) matches no chip. An episode can mix briefing and general topics (D67, D114).
- Scenario: WHEN Enter is pressed in Title THEN the keyboard goes away and no run starts.
- Scenario: WHEN a press begins inside the panel and ends on the scrim THEN the panel stays open; it closes only on a press that began on its scrim.
- A sticky Generate bar sits at the bottom of `/create`.

### Episodes
- General episodes are built from news feeds ranked by coverage (D43). World, Business, Science, Culture and Sports are topics of their own (origin `general`) whose feeds are ordinary sources (D66).
- Scripts open with a rundown, deep-dive the lead stories, give the rest as nuggets and close short (D68).
- Discussion episodes use a second voice by default (`dominic_32`). The two hosts take names that fit their voices (D74); the writer is told them. The transcript names a speaker only where the speaker changes; a readout names nobody.
- Custom episodes are narrated in the voices of their request.
- Two Catch ups in a rolling 24-hour window that came out or are being made (failed or cancelled runs do not count, D213); tries are two minutes apart and twelve a day.
- The writer is told the length in words and a script is held to what its stories can carry. Since D80 the writer is asked for 95% of what the stories can carry and a script within 5% of the floor is kept, so most episodes are written once; a script attempt stops after 8 minutes. `singularity podcast --dry-run` measures one request without writing.
- Real dry runs put 5 and 10 minute episodes at 83 to 90% of the length asked for.

### Podcast queue
- Making something shows live stages: seven for a briefing (one per workflow step, then "Updating the site"), three for an episode ("Getting ready", "Making the episode", "Adding it to your Library"; `podcast.yml` makes the whole episode in one step).
- The queue (D218) lists a Catch up and a regeneration while it is being made, and nothing else: a Daily or Weekly made on the schedule is never listed, nor is a delete. Below 64rem it is a dock directly above the bottom bar (never a modal): folded it is one row, "Generating podcast 45%" (or "Generating 2 podcasts"); a tap on the row, the chevron or a swipe up opens the rows, and a swipe down or the chevron folds it. From 64rem a row at the foot of the side column, under "Updated {date}", opens the same rows in a popover. The row is hidden when nothing is being made.
- A row has a thumbnail (the episode's colour, a regeneration's own cover, a regenerate badge on a regeneration), the name with the time left at its end, the stage under it, Cancel, Listen now for a live episode, and a ring with the percent inside. Nothing in a row moves when the stage, the time left or the percent changes. Cancel goes once the voices are being recorded (the spend would go unrecorded) and in the wait for the site.
- A run that ends well leaves the queue and a toast says so ("Episode ready" or "Podcast ready" with Open, which stays until used). A failed or lost run stays with its reason and Try again, Details and a dismiss; a cancelled one stays as "Cancelled" until dismissed.
- The queue knows of a run in two ways: this browser's record (`singularity:run`) and, while anything shows, `/api/generations` for the runs of other devices. A device with nothing on record does not ask, so a run started on another device shows only once this one has something to show.
- Scenario: WHEN a briefing run ends while the player's page is open THEN a toast says so, with Open or the run's failure line.
- Scenario: WHEN a run fails THEN its request is kept and Try again is offered; the next run starts from empty. A failed row says what failed, why in a sentence (an episode's `reason`), and that nothing was changed. A refusal names its own wait; a request that cannot go from the row reopens the form filled in.
- Each generation in that list carries what it is: `kind` is `catch_up` or `regenerate` (a Daily or Weekly made on the schedule is never listed, nor is a delete) and `target` is the digest or episode id a regeneration replaces, when its run title says (`regenerate <id>`, which podcast.yml and, since D217, run.yml both write; a briefing made by hand or under the old title `run` has no target). A row is named for that, never for the episode's own title: `Catch up · 7 Oct`, `Daily podcast · 7 Oct`, `Weekly podcast · W24` (ISO week), `Podcast · 7 Oct` (`lib/queueNames.ts`); two rows that would read the same get their start time added. The percent is a share of the time the run is expected to take, weighed by each stage's usual length and never 0 once running or 100 before it is done (`lib/queuePercent.ts`).
- Scenario: WHEN Cancel is pressed THEN the run stops and its row ends as "Cancelled" without Try again (another device's run is simply gone); WHEN GitHub refuses THEN the row stays and says it could not cancel.
- Opening the new episode, or having it on screen, forgets the finished run.
- Scenario: WHEN an episode is still being made THEN Catch up says so instead of sending a second request.
- After a publish the page reads `/latest.json` every 2.5 s and, when an episode goes live, pre-narrates its first two turns (D82).
- A new episode can be heard from a live copy in Blob while it is written (Listen now on the queue's row, about 35 to 45 s) (D105). Until its cover is deployed, the player's cover box takes the cover's colour from that copy.
- Toasts share one quiet style with an icon for success and failure.

## Code
- `apps/web/src/components/CreateForm.astro`
- `apps/web/src/lib/createForm.ts`
- `apps/web/src/sheets`
- `apps/web/src/scripts/runStatus.ts`
- `apps/web/src/scripts/queue.ts`, `apps/web/src/scripts/queueEntry.ts`, `apps/web/src/components/Queue.astro`, `apps/web/src/styles/queue.css`
- `apps/web/src/lib/generations.ts`, `apps/web/src/lib/queueNames.ts`, `apps/web/src/lib/queuePercent.ts`
- `apps/web/src/server/generations.ts` (`/api/generations`, `/api/cancel`)
- `apps/web/src/server/podcast.ts`
- `packages/engine/src/podcast`
- `.github/workflows/podcast.yml`
