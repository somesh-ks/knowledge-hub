# Settings

Schedule, sources, preferences, voices, model, autosave and the edit gap, blocked outlets. What it does now. Reasons: D45 to D132 (the Index); history: docs/history/.

## Requirements

### Structure
- Settings is two levels (D51): an index and one page per job. Sections, 18 to 20px regular H2s (D125): Podcast (Daily, Weekly, Sources, Preferences, with summaries), Intelligence (the AI model alone), Sound (Podcast voice, Interface sounds: `/settings/voice`, `/settings/sounds`), Appearance (Theme), About (D129). No heading is bold.
- Each group of rows is a card: `.card-group` (primitives.css) on the `.rows` list, on the container tone, no shadow or line (Material 3 grouping). The install offer is one in the accent tone. About: the description, a Change log row (`/settings/about`, versions from `lib/changelog.ts`, newest first) and, on a phone, Last updated, which from 64rem sits at the foot of the side column (`AppNav`).
- No breadcrumbs: a title stands alone and a phone's app bar arrow leads up (D129). `/settings/custom` goes to `/create`; `custom` in `config/schedule.json` is what the Create panel starts from.
- Form fields have a 3:1 outline. Every select opens one drawn list set in `primitives.css` through `appearance: base-select` (Chromium 135+, Safari 27; native lists elsewhere). Time zone and voices use searchable pickers (D101). Theme is a select that draws no value until the stored one is set.

### Schedule
- Daily and Weekly each show Episode, Schedule, Topics, in that order: Length (both) and Format (Readout or Discussion; Weekly only, Length first), then time zone (about 55, searchable; one for both), time, repeat (Daily) or day (Weekly). The Daily has no type: a top-level `format` in `config/schedule.json` is ignored and not written. A voice sample button is a 40px disc in a 48px target. No Configure row, no voice rows, and Weekly has no on/off switch (the engine still reads `weekly.enabled`, true) (D129).
- One voice pair serves Daily, Weekly and Catch up, chosen on `/settings/voice` (Primary and Secondary, each with a sample): `voice_id` and `voice_id_b` at the top of `config/schedule.json`, read by `podcastVoices()`. The per-podcast voices already stored apply only while the pair is unset. New episode keeps a per-request voice that defaults to the pair (D129).
- `config/schedule.json` holds the Daily fields (no format), a `timezone` (Europe/Stockholm by default), a `weekly` profile (day, hour, topics left out, format, length, on/off) and a `custom` profile; skipped topics are `skip_topics`, `weekly.skip_topics`, `custom.skip_topics`. Weekly follows its own day, hour, topics and length and takes Sunday over the Daily (D63, D65).
- The Topics section shows every topic as a chip (D102): the owner's four (Design, Software Engineering, AI, Technology), their own and the five general topics (World, Business, Science, Culture, Sports), which play as sections of their own (two stories each, outside the briefing's cap) once ticked and start unticked until the first edit of a skip list writes `general_scoped` (`effectiveSkipTopics`, core).

### Sources
- Sources (page title too, D129) is a search, Add and the topics by name, one page each, each led by an emoji (D69, D125): fixed for shipped topics (`BUILTIN_TOPIC_EMOJI`, core), Jev's for an added one (`/api/topic-emoji`, stored as `emoji`) or `fallbackEmoji`. No Other row; Blocked sources (red mark) sits under a line. Search and filters are the Library's `.search-field` and `.filter-chip` (held by `styles.test.ts`).
- A topic's page has a card (art from `topicArt.ts`, name, what counts, a More menu with Edit and, for the owner's topics, Delete; Listen in: Daily, Weekly, Catch up), no switch (D102), a card holding the Sources | Preferences switch (`?view=preferences`, so a reload keeps it; Other has none) and, under it, the search, type chips, sources and Suggested sources, each name opening its editor (D83); past seven they fold (D103).
- Preferences holds Topic weightage and, on World and Business or a topic with a saved lean, Perspective (Left to Right). Weights are fixed-stop sliders: Off 0 (never published), Less 0.5, Normal 0.7, More 0.85, Most 0.95 (D124, D129).
- The type mix is global (D129): `format_mix` in `config/preferences.json`, op `mix.set`, edited on `/settings/preferences` with seven sliders (Off, Less, Normal, More, Most; default Normal) and applied by the engine to every story (`applyFormatMix`). `topic.mix` carries perspective only; per-topic mixes are not read. "Type" is the user-facing word for a source's format.
- Search filters every source as a flat list, or a topic's (lifting the fold). Type chips (any number, none means all) on a scrolling row, sticky with the search below 64rem. State is in the URL. A source's type is the rule's when added, then Jev within 3 s (D124).
- Edit: every topic takes a new name; what counts edits except on a built-in category (D57, D64, D71). The add topic panel takes Name, Description and Scope, with suggested sources, each with a plus. A topic's page lists up to five catalogue feeds that fit it (D75).
- A new topic is a list row at once, by name, with `topicEmoji`'s guess until Jev's pick (D142); its one `topic.upsert` waits for Jev (4.5 s at most). Before the build it opens `/settings/topics/new?id=`, filled from the saved edits (`fillShell`). Suggested sources show only on a topic's page.
- Add source (beside the search from 64rem) lists suggestions for its topic. A suggested add shimmers, then moves into Sources and the next fills its place (10 rendered, 5 shown).
- A source row shows name, address, stories that reached a briefing and a star rating or "Not scored yet" (D83, D102, D103); a checkbox turns it on and off. A row opens a side panel (full screen on a phone, pulled down to close) to rename, move, open or Delete it: a confirm, then the row goes at once and the removal waits 5 s with Undo (D56, D125, D129, D142). A source added from the panel joins at once under the page's id (`source.add` takes an optional `id`).
- `GET /api/source-preview` is behind an SSRF guard.

### Model
- No model select: models follow `config/models.json` (engine spec). A read-only Models card is not built.

### Autosave and the edit gap
- Changes save themselves (`apps/web/src/scripts/autosave.ts`, D115): 1.2 s after the last change, at most 8 ops a request. No toast while saving or once saved. The toast is for a failure (reason and Retry), an Undo, or the time refused. A removal leaves the page at once; its request waits 5 s with Undo (D142).
- Scenario: WHEN a second change comes inside the server's 10 s gap THEN it waits and goes with the rest in one request, also when the page is left: waiting edits are kept in storage, marked pending, for up to 90 s (D91).
- Scenario: WHEN the held request fails THEN the open page shows "Not saved yet" with the reason and Retry, and the index says "Your last change was not saved." (D98). Elsewhere a toast names the page with Open (D99).
- For three minutes after a save a settings page that opens shows the saved value, not the stale built-in one, with no line saying so (`dispatch:saved-edits`, D79, D115).

### Blocked outlets and votes
- A user profile (`config/profiles/owner.json`) holds blocked domains and story votes (D108). A blocked outlet is cut on every fetch path. Votes nudge ranking, the Firecrawl listing order and the writer.
- Scenario: WHEN "Stop hearing from" is pressed THEN it waits out the server's ten seconds between config edits, goes with the votes in one request, stays on the device until the server takes it, and the Blocked outlets page lists it at once.

## Code
- `apps/web/src/pages/settings.astro`, `settings/about.astro`, `lib/changelog.ts`
- `apps/web/src/pages/settings/topics.astro`, `topics/[id].astro`, `preferences.astro`, `voice.astro`
- `apps/web/src/scripts/autosave.ts`
- `apps/web/src/scripts/settingsPage.ts`
- `apps/web/src/pages/api/config.ts`
- `packages/core/src/configOps.ts`
- `.github/workflows/config.yml`
