# Settings

Schedule, sources, preferences, voices, model, autosave and the edit gap, blocked outlets. What it does now. Reasons: D45, D46, D51, D55 to D57, D62 to D65, D69, D71, D75, D79, D83, D88, D91, D98 to D103, D106, D108, D113, D115, D124, D125, D129; history: docs/history/.

## Requirements

### Structure
- Settings is two levels (D51): an index and one page per job. Sections, 18 to 20px regular H2s (D125): Podcast (Daily, Weekly, Sources, Preferences, with summaries), Intelligence (the AI model alone), Sound (Podcast voice, Interface sounds: `/settings/voice`, `/settings/sounds`), Appearance (Theme), About (D129). No heading is bold.
- No breadcrumbs: a title stands alone and a phone's app bar arrow leads up; a topic page has no "‹ Sources" link (D129, amends D87). Destination titles are 22px from 64rem (D89).
- No Custom page: `/settings/custom` goes to `/create`; `custom` in `config/schedule.json` is what the Create panel starts from.
- Form fields have a 3:1 outline. Every select opens one drawn list set in `primitives.css` through `appearance: base-select` (Chromium 135+, Safari 27; native lists elsewhere). Time zone and voices use searchable pickers (D101). Theme is a select that draws no value until the stored one is set.

### Schedule
- Daily and Weekly each choose time zone (about 55, searchable; one for both), time, repeat, Length and Format (Readout or Discussion), the last two selects. No Configure row, no voice rows, and Weekly has no on/off switch (the engine still reads `weekly.enabled`, true) (D129).
- One voice pair serves Daily, Weekly and Catch up, chosen on `/settings/voice` (Primary and Secondary, each with a sample): `voice_id` and `voice_id_b` at the top of `config/schedule.json`, read by `podcastVoices()`. The per-podcast voices already stored apply only while the pair is unset. New episode keeps a per-request voice that defaults to the pair (D129).
- `config/schedule.json` holds the Daily fields, a `timezone` (Europe/Stockholm by default), a `weekly` profile (day, hour, topics left out, type, length, on/off) and a `custom` profile; skipped topics are `skip_topics`, `weekly.skip_topics`, `custom.skip_topics`. The weekly run follows its own day, hour, topics and length (D63, D65).
- The Topics section shows every topic as a chip (D102): the owner's three, their own and the five general topics (World, Business, Science, Culture, Sports), which play as sections of their own (two stories each, outside the briefing's cap) once ticked and start unticked until the first edit of a skip list writes `general_scoped` (`effectiveSkipTopics`, core).

### Sources
- Sources (page title too, D129) is a search, Add and the topics by name, one page each, each led by an emoji (D69, D125): fixed for shipped topics (`BUILTIN_TOPIC_EMOJI`, core), Jev's for an added one (`/api/topic-emoji`, stored as `emoji`) or `fallbackEmoji`. No Other row. Blocked sources (red skip mark) sits under a line. Search is the Library's `.search-field`, type filters its `.filter-chip` (held by `styles.test.ts`).
- A topic's page has a card (art from `topicArt.ts`, name, what counts, a More menu with Edit and, for the owner's topics, Delete; Listen in: Daily, Weekly, Catch up), no switch (D102), a card holding the Sources | Preferences switch (`?view=preferences`, so a reload keeps it; Other has none) and, under it, the search, type chips, sources and Suggested sources, each name opening the row's editor (D83). Sources past seven fold (D103).
- Preferences holds Topic weightage and, on World and Business or a topic with a saved lean, Perspective (Left to Right). Weights are fixed-stop sliders: Off 0 (never published), Less 0.5, Normal 0.7, More 0.85, Most 0.95 (D124, D129).
- The type mix is global (D129): `format_mix` in `config/preferences.json`, op `mix.set`, edited on `/settings/preferences` with seven sliders (Off, Less, Normal, More, Most; default Normal) and applied by the engine to every story (`applyFormatMix`). `topic.mix` carries perspective only; per-topic mixes are not read. "Type" is the user-facing word for a source's format.
- Search filters every source as a flat list, or a topic's (lifting the fold). Type chips (any number, none means all) on a scrolling row, sticky with the search below 64rem. State is in the URL. A source's type is the rule's when added, then Jev within 3 s (D124).
- Edit: every topic takes a new name; what counts edits except on a built-in category (D57, D64, D71). The add topic panel takes Name, Description and Scope, with suggested sources, each with a plus. A topic's page lists up to five catalogue feeds that fit it (D75).
- Add source (beside the search from 64rem) lists suggestions for its chosen topic. A suggested add shimmers, then the source moves into Sources and the next suggestion fills its place (10 rendered, 5 shown).
- A source row shows name, address, stories that reached a briefing and a star rating or "Not scored yet" (D83, D102, D103); a checkbox turns it on and off. A row opens a side panel (full screen, pulled down to close, on a phone) to rename it, move it to another topic, open its address or Delete: a confirm dialog, then immediate removal with no Undo (D56, D125, D129). A source added from the panel joins its topic at once under an id the page chose (`source.add` takes an optional `id`).
- `GET /api/source-preview` (name, icon, feed, latest post, score, format) is behind an SSRF guard.

### Model
- One AI model select, alone in the Intelligence section (D46, D113, D106, D125): the writer's provider (Nebius or Anthropic) and model, a plain dropdown with no Default row. Under Top models: newest Claude Opus, Sonnet and Haiku and the five top Nebius writers by name (D58, `NEBIUS_TOP` in `apps/web/src/lib/modelId.ts`); under All models every live model. Claude Sonnet 5.5 is the default and Nebius starts on GLM-5.3. Kimi models are never offered (D130). The saved model is always an option; an id cannot be typed.
- The engine tries the chosen model first and falls back to the Nebius environment models with a warning (D49).
- A choice for the page after a reload is noted only once its request was accepted, so a refused choice never reads Saved (D99).

### Autosave and the edit gap
- Changes save themselves (`apps/web/src/scripts/autosave.ts`, D115): 1.2 s after the last change, at most 8 ops a request. No toast while saving or once saved. The toast is for a failure (reason and Retry), an Undo, or the time refused.
- Scenario: WHEN a second change comes inside the server's 10 s gap THEN it waits and goes with everything changed meanwhile in one request, also when the page is left inside the app: waiting edits are kept in storage marked pending for up to 90 s and the next page shows them (D91).
- Scenario: WHEN the held request fails THEN the open page shows "Not saved yet" under its title, takes the lost changes as its own with the reason and Retry, and the Settings index says "Your last change was not saved." (D98). Elsewhere a toast names the page with an Open button (D99).
- For three minutes after a save a settings page that opens shows the saved value, not the stale built-in one, with no line saying so (`dispatch:saved-edits`, D79, D115).

### Blocked outlets and votes
- A user profile (`config/profiles/owner.json`) holds blocked domains and story votes (D108). A blocked outlet is cut on every fetch path. Votes nudge ranking, the Firecrawl listing order and the writer.
- Scenario: WHEN "Stop hearing from" is pressed THEN it waits out the server's ten seconds between config edits, goes with the votes in one request, stays on the device until the server takes it, and the Blocked outlets page lists it at once.
- Stories opened at their source are kept as opens and ride the vote batch (D118).

## Code
- `apps/web/src/pages/settings.astro`
- `apps/web/src/pages/settings/topics.astro`, `topics/[id].astro`, `preferences.astro`, `voice.astro`
- `apps/web/src/scripts/autosave.ts`
- `apps/web/src/scripts/settingsPage.ts`
- `apps/web/src/pages/api/config.ts`
- `packages/core/src/configOps.ts`
- `.github/workflows/config.yml`
