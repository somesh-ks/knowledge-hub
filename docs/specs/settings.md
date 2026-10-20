# Settings

Schedule, topics and sources, model, autosave and the edit gap, blocked outlets. What it does now. Reasons: D45, D46, D51, D55 to D57, D62, D63, D64, D65, D69, D71, D75, D79, D83, D88, D91, D98 to D103, D106, D108, D113, D115; history: docs/history/.

## Requirements

### Structure
- Settings is two levels (D51): an index and one page per job. Index rows: Daily, Weekly, Topics & Sources and AI Model with a one-line summary each (the Topics row says only how many topics and sources there are); Interface sounds; Appearance; About. Copy: Listen in, Topic weightage, Configure, Primary and Secondary voice (D103).
- Page titles are breadcrumbs ("Settings › Daily") from 64rem; below it the title stands alone and the app bar's arrow leads up. Destination titles are 22px from 64rem (D87, D89).
- No Custom page: `/settings/custom` goes to `/create`; `custom` in `config/schedule.json` is what the Create panel starts from. Old addresses redirect (`astro.config.mjs`).
- Form fields have a 3:1 outline. Dividers sit inside content. Every select opens one drawn list set in `primitives.css` through `appearance: base-select` (Chromium 135+, Safari 27; native lists elsewhere), below its field when it fits. Time zone and voices use searchable pickers (D101).

### Schedule
- Daily and Weekly each choose their time zone (about 55 zones, west to east, each named with place and offset as of today, "Stockholm (GMT+2)", from a searchable list; one setting for the whole schedule, shown on both pages), time (read in that zone), repeat, length, format (Readout or Discussion) and two voices, Voice and Discussion voice, each with a play button dimmed when the voice has no sample (D45, D63, D71, D100, D101).
- A briefing is narrated from its digest by one voice, so Format and the Discussion voice take effect only where a discussion is made (New episode).
- `config/schedule.json` holds the Daily fields, a `timezone` (Europe/Stockholm by default), a `weekly` profile (day, hour, topics left out, type, length, voices, on/off) and a `custom` profile; skipped topics are `skip_topics`, `weekly.skip_topics`, `custom.skip_topics`. The weekly run follows its own day, hour, topics and length (D63). Weekly day: D65.
- While Weekly is on, Sunday prioritizes the weekly podcast over daily; the When hint reads "Prioritizes weekly podcast on overlapping days."
- The Topics section shows every topic as a chip, all selectable (D102): the owner's three, their own and the five general topics (World, Business, Science, Culture, Sports), which play as sections of their own (two stories each, outside the briefing's cap) once ticked and start unticked until the first edit of a skip list writes `general_scoped` (`effectiveSkipTopics`, core). A link row leads to Topics & Sources, where each topic's Scope says which podcasts it is in (D69).
- A topic chip keeps one width as its check comes and goes.

### Topics and sources
- Topics & Sources lists topics by name, Other last, one page each (D69): Design, AI and Technology gather the judge topics, then the owner's and the five general topics. Built-in groups have no More menu (`TOPIC_GROUPS`).
- A topic's page has a summary card (picture from `packages/cover/src/topicArt.ts`, name, what counts, a More menu with Edit and, for the owner's topics, Delete), a Podcasts multi-select ("All podcasts" when all three), no on and off switch (D102), a weight per judge topic it gathers, and its sources, each name opening the row's editor (D83). Sources past seven fold (D103).
- Weights are fixed-stop sliders: Off 0 (never published), Less 0.5, Normal 0.7, More 0.85, Most 0.95, named beside it. A page whose sources use two formats or more has a Formats slider per format; a group keeps one mix on its home topic (`groupHomeId`). A general topic has Perspective, Left to Right (D124).
- Search and chips (formats, then statuses; OR within a row, AND across; state in the URL) filter the index's sources as a flat list and a topic's, lifting the fold. Format is on each source: the type's rule fills it when one is added, then Jev within 3 s (D124).
- Edit: every topic takes a new name; what counts edits except on a built-in category (D57, D64, D71).
- The add topic panel takes Name, Description and Scope; the topic stays on the list until the build (D79), with suggested sources, each with a plus. A topic's page lists up to five catalogue feeds that fit it, no scores (D75).
- A source row shows name, address, stories that reached a briefing (a general feed: how many another outlet also carried) and a star rating or "Not scored yet" (D83, D102, D103); the edit panel has the scorecard, an empty state and Delete. A checkbox reads it or not. A source added from the panel joins its topic's list at once under an id the page chose (`source.add` takes an optional `id`), so its checkbox, editor and Delete work before the build.
- A row opens a side panel to rename it, move it to another topic or open its address (D56). A move or rename is `source.update`; a move also sets the category hint in a run.
- `GET /api/source-preview` (name, icon, feed, latest post, score, format) is behind an SSRF guard. A site with no icon shows its first letter.

### Model
- One AI model select (D46, D113, D106): the writer's provider (Nebius or Anthropic) and model, a plain dropdown with no Default row. Under Top models: newest Claude Opus, Sonnet and Haiku and the six top Nebius writers by name (D58, `NEBIUS_TOP` in `apps/web/src/lib/modelId.ts`); under All models every live model. Claude Sonnet 5.5 is the default and Nebius starts on GLM-5.3. The saved model is always an option; an id cannot be typed. Sonnet 5.5 and Haiku 5.5 are always offered.
- The engine tries the chosen model first and falls back to the Nebius environment models with a warning (D49).
- A choice for the page after a reload is noted only once its request was accepted, so a refused choice never reads Saved (D99).

### Autosave and the edit gap
- Changes save themselves (`apps/web/src/scripts/autosave.ts`, D115): 1.2 s after the last change, at most 8 ops a request. No toast while saving or once saved (a screen reader hears "Saved."). The toast is for a failure (reason and Retry), an Undo, or the time refused. A removal waits 5 s with Undo. The toast keeps the control just changed in sight.
- Scenario: WHEN a second change comes inside the server's 10 s gap THEN it waits and goes with everything changed meanwhile in one request, also when the page is left inside the app: waiting edits are kept in storage marked pending for up to 90 s and the next page shows them (D91).
- Scenario: WHEN the held request fails THEN the open page shows "Not saved yet" under its title, takes the lost changes as its own with the reason and Retry, and the Settings index says "Your last change was not saved." (D98). On Today or the Library the toast says "Your change to Daily was not saved." with an Open button (D99).
- For three minutes after a save a settings page that opens shows the saved value, not the stale built-in one, with no line saying so (`dispatch:saved-edits`, D79, D115).

### Blocked outlets and votes
- A user profile (`config/profiles/owner.json`) holds blocked domains and story votes (D108). A blocked outlet is cut on every fetch path. Votes nudge ranking, the Firecrawl listing order and the writer.
- Scenario: WHEN "Stop hearing from" is pressed THEN it waits out the server's ten seconds between config edits, goes with the votes in one request, stays on the device until the server takes it, and the Blocked outlets page lists it at once.
- Stories opened at their source are kept as opens and ride the vote batch (D118).

## Code
- `apps/web/src/pages/settings.astro`
- `apps/web/src/pages/settings/topics.astro`
- `apps/web/src/scripts/autosave.ts`
- `apps/web/src/scripts/settingsPage.ts`
- `apps/web/src/server/configEdit.ts`
- `apps/web/src/pages/api/config.ts`
- `packages/core/src/configOps.ts`
- `.github/workflows/config.yml`
