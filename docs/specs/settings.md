# Settings

Schedule, sources, preferences, voices, model, autosave, blocked outlets. Reasons: D45 to D132.

## Requirements

### Structure
- Settings has two levels (D51): an index, a page per job. Sections are 18 to 20px regular H2s (D125): Podcast settings (Daily, Weekly, Sources, Structure at `/settings/preferences`), App settings (Appearance, Sound and voice, Haptics with On or Off, Notifications) and About: three rows, no head, and a small centred "Last updated on 2 Nov, 2026" on a phone (D335).
- `/settings/appearance`: Theme, Mood and, for a mood only, a full-width Hue row (D328). `/settings/sound`: Interface sounds (switch, Volume), Podcast voices and Playback (autoplay, default speed); `/settings/sounds` and `/settings/voice` redirect. `/settings/haptics`: a switch.
- `/profile` (D335): no heading; the avatar with an edit button that opens the mood's shapes (`--av-shapes`) in a bottom sheet; a Log in button (a dummy until Google); Downloads and Saved. It reacts to offline, a run, playing, success, failure and a favourite (`accountAvatar.ts`; not under reduced motion).
- Link rows end in their value, in quiet ink, 64px tall.
- Each group of rows is a card: `.card-group` (primitives.css) on `.rows`; contents concentric (`component.card`). Heads share the rows' edge. The install offer is accent-toned. About: About, Privacy, Change log (`/settings/changelog`) and, on a phone, Last updated, at the side column's foot from 64rem (`AppNav`).
- A subpage has a "Settings /" line above its title ("Profile /" on Downloads and Saved), linking up (amends D129). `/settings/custom` goes to `/create`.
- Form fields have a 3:1 outline. Every select opens one drawn list. Time zone and voices use searchable pickers (D101). Theme and Mood draw no value till the stored one is set.

### Schedule
- Daily and Weekly show Episode, Schedule, Categories: Max length (no Format and no Look back: a podcast covers everything since its last episode, D215), Profile (off, D191), then time zone (one for both), time, repeat (Daily) or day (Weekly). No voice rows; each has an on/off switch (the engine reads the top-level `enabled` for Daily and `weekly.enabled` for Weekly).
- A device whose clock differs from the schedule's zone is offered the switch in a toast and never switched; a dismissal lasts for that device zone until the clocks agree again (D239).
- One voice pair serves Daily, Weekly and Catch up, chosen on `/settings/sound` (Primary, Secondary): `voice_id` and `voice_id_b` at the top of `config/schedule.json`, read by `podcastVoices()`. Stored per-podcast voices apply only while the pair is unset. New episode's per-request voice defaults to the pair (D129).
- `config/schedule.json`: the Daily fields (no format), `timezone` (Europe/Stockholm by default), a `weekly` profile (day, hour, skipped topics, length, on/off) and `custom`; Weekly follows its own day, hour, topics and length and takes Sunday over the Daily (D63, D65).
- The Categories section shows each category as a chip by name (D102): the owner's four, their own and five general ones (World, Business, Science, Culture, Sports), which play as sections of their own once ticked and start unticked until a skip list's first edit writes `general_scoped` (`effectiveSkipTopics`).

### Sources
- Sources is a search, Add and the topics by name, one page each, each led by an emoji: fixed for shipped topics (`BUILTIN_TOPIC_EMOJI`, core), Jev's for an added one (`/api/topic-emoji`, stored as `emoji`) or `fallbackEmoji`. No Other row; Blocked sources sits under a line.
- A topic's page: a card (art, name, what counts, a More menu with Edit and, for the owner's topics, Delete; Listen in), no switch (D102) and no tabs; under it the search, type chips, sources and Suggested sources, each name opening its editor (D83); past seven they fold (D103).
- A topic has no weight and no Perspective slider (D194, #514); a muted topic stays muted.
- The type mix is global (D129): `format_mix` in `config/preferences.json`, op `mix.set`, applied by the engine to every story (`applyFormatMix`). The app no longer offers its sliders (D335); a stored mix still applies.
- Structure (`/settings/preferences`): one block list for every type under a Profile select (presets; Custom on edit; D191), Reorder and Edit; emptied, an empty state, nothing saved; [design](../design/podcast-structure.md), D182.
- Blocked sources: the field filters; Block opens a sheet.
- Search filters every source as a flat list, or a topic's. Type chips: any number, none means all. State is in the URL. A source's type is the rule's when added, then Jev within 3 s (D124).
- Edit: every topic takes a new name; what counts edits except on a built-in category (D57, D64, D71). The add topic panel takes Name, Description and Scope, with suggested sources, each with a plus; a topic's page lists up to five catalogue feeds that fit (D75).
- A new topic is a list row at once, by name, with `topicEmoji`'s guess until Jev's pick (D142); its one `topic.upsert` waits for Jev (4.5 s at most). Before the build it opens `/settings/topics/new?id=`, filled from the saved edits (`fillShell`). Suggested sources show only on a topic's page.
- Add source (beside the search from 64rem) lists its topic's suggestions; an added one shimmers, moves into Sources and the next fills its place.
- A source row: name, address, a star rating or "Not scored yet" (the last run's, from `/api/source-ratings`), a checkbox. Its side panel renames, moves, favorites (`high_signal`), opens or deletes: a delete confirms, leaves at once, Undo for 5 s (D142).
- `GET /api/source-preview` is behind an SSRF guard.

### Model
- No model select: models follow `config/models.json` (engine spec).

### Autosave and the edit gap
- Changes save themselves (`autosave.ts`, D115): 1.2 s after the last, at most 8 ops a request. The toast is only for a failure (reason, Retry), an Undo or the refused time. A removal leaves at once; its request waits 5 s with Undo (D142). A 400 naming its op drops only that change.
- Scenario: WHEN a second change comes inside the server's 10 s gap THEN it waits and goes with the rest in one request, also when the page is left: waiting edits are kept, marked pending, up to 90 s (D91).
- Scenario: WHEN a page reloads while its request is out THEN the next shows the change (D259).
- Scenario: WHEN a change is made offline THEN it stays on the device (two weeks), shows saved, and goes out oldest first on the next online page load or change (D299).
- Scenario: WHEN the held request fails THEN the open page shows "Not saved yet" with the reason and Retry, and the index says "Your last change was not saved." (D98). Elsewhere a toast names the page with Open (D99).
- For three minutes after a save a settings page shows the saved value, with no line saying so (`singularity:saved-edits`, D79, D115).
- With the config store on (D149) a settings page lays what the store holds over its built copy; slow or down, what this device last read (D172), else the build. What it changes, index lines too, waits hidden.

### Blocked outlets and votes
- A user profile (`config/profiles/owner.json`) holds blocked domains and story votes (D108). A blocked outlet is cut on every fetch path. Votes nudge ranking, the Firecrawl listing order and the writer.
- Scenario: WHEN "Stop hearing from" is pressed THEN it waits out the server's ten seconds between edits, goes with the votes in one request, stays on the device until taken, and the Blocked outlets page lists it at once.

## Code
- `apps/web/src/pages/settings.astro`, `settings/about.astro`, `lib/changelog.ts`
- `apps/web/src/pages/settings/categories.astro`, `categories/[id].astro`, `preferences.astro`, `voice.astro`
- `apps/web/src/scripts/autosave.ts`, `pageLeaving.ts`, `structureEditor.ts`, `lib/outbox.ts`
- `apps/web/src/scripts/settingsPage.ts`
- `apps/web/src/pages/api/config.ts`, `server/configView.ts`
- `packages/core/src/configOps.ts`
- `.github/workflows/config.yml`
