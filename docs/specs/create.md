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
- Twelve episodes a day, two minutes apart.
- The writer is told the length in words and a script is held to what its stories can carry. Since D80 the writer is asked for 95% of what the stories can carry and a script within 5% of the floor is kept, so most episodes are written once; a script attempt stops after 8 minutes. `singularity podcast --dry-run` measures one request without writing.
- Real dry runs put 5 and 10 minute episodes at 83 to 90% of the length asked for.

### Run indicator
- Making something shows live stages: seven for a briefing (one per workflow step, then "Updating the site"), three for an episode ("Getting ready", "Making the episode", "Adding it to your Library"; `podcast.yml` makes the whole episode in one step).
- Scenario: WHEN a run fails THEN its request is kept and Try again is offered; the next run's bar starts from empty. A refusal names its own wait; a request that cannot go from the line reopens the form filled in.
- Opening the new episode, or having it on screen, clears "Episode ready".
- Scenario: WHEN an episode is still being made THEN Catch up says so instead of sending a second request.
- After a publish the indicator reads `/latest.json` every 2.5 s and, when an episode goes live, pre-narrates its first two turns (D82).
- A new episode can be heard from a live copy in Blob while it is written (Listen now on the run card, about 35 to 45 s) (D105).
- Toasts share one quiet style with an icon for success and failure.

## Code
- `apps/web/src/components/CreateForm.astro`
- `apps/web/src/lib/createForm.ts`
- `apps/web/src/sheets`
- `apps/web/src/scripts/runStatus.ts`
- `apps/web/src/server/podcast.ts`
- `packages/engine/src/podcast`
- `.github/workflows/podcast.yml`
