# Settings

Schedule, sources, preferences, voices, model, autosave, blocked outlets. Reasons: D45 to D132; history: docs/history/.

## Requirements

### Structure
- Settings is two levels (D51): an index and one page per job. Sections, 18 to 20px regular H2s (D125): Podcast (Daily, Weekly, Sources, Preferences), Sound (Podcast voice, Interface sounds: `/settings/voice`, `/settings/sounds`), Appearance (Theme), Analytics (Costs; User engagement opens Simple Analytics, D153), About (D129).
- Link rows end in their value, in the quiet ink; rows are 64px.
- Each group of rows is a card: `.card-group` (primitives.css) on `.rows`, no shadow or line; its contents are concentric (`component.card`). Heads share the rows' edge. The install offer is one in the accent tone. About: About, Privacy, Change log (`/settings/changelog`, newest first) and, on a phone, Last updated, at the side column's foot from 64rem (`AppNav`).
- No breadcrumbs: a title stands alone and a phone's app bar arrow leads up (D129). `/settings/custom` goes to `/create`; `custom` in `config/schedule.json` is what the Create panel starts from.
- Form fields have a 3:1 outline. Every select opens one drawn list (`appearance: base-select`). Time zone and voices use searchable pickers (D101). Theme is a select that draws no value until the stored one is set.

### Schedule
- Daily and Weekly show Episode, Schedule, Categories: Max length, Format (Weekly), Look back (`lookback_hours`: unset is since the last episode, else 12 h to 7 days, D184), Profile (off, D191), then time zone (one for both), time, repeat (Daily) or day (Weekly). A top-level `format` is ignored, not written. No voice rows; Weekly has no switch (the engine reads `weekly.enabled`) (D129).
- One voice pair serves Daily, Weekly and Catch up, chosen on `/settings/voice` (Primary and Secondary, each with a sample): `voice_id` and `voice_id_b` at the top of `config/schedule.json`, read by `podcastVoices()`. The per-podcast voices already stored apply only while the pair is unset. New episode keeps a per-request voice that defaults to the pair (D129).
- `config/schedule.json`: the Daily fields (no format), `timezone` (Europe/Stockholm by default), a `weekly` profile (day, hour, skipped topics, format, length, on/off) and `custom`; skipped topics are `skip_topics`, `weekly.skip_topics`, `custom.skip_topics`. Weekly follows its own day, hour, topics and length and takes Sunday over the Daily (D63, D65).
- The Categories section shows each category as a chip by name (D102): the owner's four, their own and five general ones (World, Business, Science, Culture, Sports), which play as sections of their own (two stories each, outside the briefing's cap) once ticked and start unticked until the first edit of a skip list writes `general_scoped` (`effectiveSkipTopics`, core).

### Sources
- Sources (page title too, D129) is a search, Add and the topics by name, one page each, each led by an emoji (D69, D125): fixed for shipped topics (`BUILTIN_TOPIC_EMOJI`, core), Jev's for an added one (`/api/topic-emoji`, stored as `emoji`) or `fallbackEmoji`. No Other row; Blocked sources (red mark) sits under a line. Search and filters are the Library's.
- A topic's page: a card (art from `topicArt.ts`, name, what counts, a More menu with Edit and, for the owner's topics, Delete; Listen in: Daily, Weekly, Catch up), no switch (D102); a card with the Sources | Preferences switch (`?view=preferences`, kept on reload), under it the search, type chips, sources and Suggested sources, each name opening its editor (D83); past seven they fold (D103).
- Preferences holds Topic weightage and, on World and Business or a topic with a saved lean, Perspective (Left to Right). Weights are fixed-stop sliders: Off 0 (never published), Less 0.5, Normal 0.7, More 0.85, Most 0.95 (D124, D129).
- The type mix is global (D129): `format_mix` in `config/preferences.json`, op `mix.set`, edited on `/settings/preferences` with seven sliders (Off, Less, Normal, More, Most; default Normal) and applied by the engine to every story (`applyFormatMix`). `topic.mix` carries perspective only; per-topic mixes are not read. "Type" is the user-facing word for a source's format.
- Structure (`?view=structure`): one block list for every type under a Profile select (presets; Custom on edit; D191), Reorder and Edit; [design](../design/podcast-structure.md), D182.
- Weights moved by votes say "Adjusted" (D190). Blocked sources: the field filters; Block opens a sheet.
- Search filters every source as a flat list, or a topic's (lifting the fold). Type chips: any number, none means all. State is in the URL. A source's type is the rule's when added, then Jev within 3 s (D124).
- Edit: every topic takes a new name; what counts edits except on a built-in category (D57, D64, D71). The add topic panel takes Name, Description and Scope, with suggested sources, each with a plus; a topic's page lists up to five catalogue feeds that fit (D75).
- A new topic is a list row at once, by name, with `topicEmoji`'s guess until Jev's pick (D142); its one `topic.upsert` waits for Jev (4.5 s at most). Before the build it opens `/settings/topics/new?id=`, filled from the saved edits (`fillShell`). Suggested sources show only on a topic's page.
- Add source (beside the search from 64rem) lists its topic's suggestions; an added one shimmers, moves into Sources and the next fills its place (10 rendered, 5 shown).
- A source row: name, address, stories that reached a briefing, a star rating or "Not scored yet" (D83, D102, D103), a checkbox. It opens a side panel (full screen on a phone) to rename, move, favorite (`high_signal`: every post reaches the judge), open or Delete: a confirm, the row goes at once, the removal waits 5 s with Undo (D56, D125, D129, D142). A source added from the panel keeps the page's id.
- `GET /api/source-preview` is behind an SSRF guard.

### Model
- No model select: models follow `config/models.json` (engine spec).

### Autosave and the edit gap
- Changes save themselves (`autosave.ts`, D115): 1.2 s after the last change, at most 8 ops a request. The toast is only for a failure (reason, Retry), an Undo or the time refused. A removal leaves at once; its request waits 5 s with Undo (D142). A 400 naming its op (`op_index`) drops only that change.
- Scenario: WHEN a second change comes inside the server's 10 s gap THEN it waits and goes with the rest in one request, also when the page is left: waiting edits are kept in storage, marked pending, for up to 90 s (D91).
- Scenario: WHEN the held request fails THEN the open page shows "Not saved yet" with the reason and Retry, and the index says "Your last change was not saved." (D98). Elsewhere a toast names the page with Open (D99).
- For three minutes after a save a settings page that opens shows the saved value, not the stale built-in one, with no line saying so (`singularity:saved-edits`, D79, D115).
- With the config store on (D149) a settings page lays what the store holds over its built copy; slow or down, what this device last read (D172), else the build.

### Blocked outlets and votes
- A user profile (`config/profiles/owner.json`) holds blocked domains and story votes (D108). A blocked outlet is cut on every fetch path. Votes nudge ranking, the Firecrawl listing order and the writer.
- Scenario: WHEN "Stop hearing from" is pressed THEN it waits out the server's ten seconds between config edits, goes with the votes in one request, stays on the device until the server takes it, and the Blocked outlets page lists it at once.

## Code
- `apps/web/src/pages/settings.astro`, `settings/about.astro`, `lib/changelog.ts`
- `apps/web/src/pages/settings/categories.astro`, `categories/[id].astro`, `preferences.astro`, `voice.astro`
- `apps/web/src/scripts/autosave.ts`, `structureEditor.ts`
- `apps/web/src/scripts/settingsPage.ts`
- `apps/web/src/pages/api/config.ts`, `server/configView.ts`
- `packages/core/src/configOps.ts`
- `.github/workflows/config.yml`
