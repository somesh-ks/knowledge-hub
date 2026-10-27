# Narration

Narration on Play, voices, audio.yml, prewarming, budgets. What it does now. Reasons: D33, D62, D82, D98, D99, D105, D128; history: docs/history/.

## Requirements

### On Play
- A briefing is narrated story by story on Play (D33), from its digest by one voice. Stored audio plays where `audio.yml` has produced it.
- A briefing, a weekly and a catch-up episode are narrated in the schedule's one voice pair (`podcastVoices()`, D129; a schedule change reaches Play after a redeploy); a new episode in the voices of its request, which default to the pair.
- Narration comes from Speechify through `/api/narrate` with word marks (`/api/narrate-marks`); the transcript follows them, with an estimate where a segment has none.
- The page may play audio only from its own address and the Blob store (D62).
- Scenario: WHEN narration is refused or fails (503, or a deployment with no narration route: 405, 501) THEN the page says "Narration is not available right now".
- Scenario: WHEN `singularity publish` runs THEN recent episodes lacking stored turns are narrated whole (`publishEpisodes.ts`): `audio/<ep-id>/seg/t<idx>.<hash>.mp3` and `.marks.json`, the hash being sha256 of voice, model, language and text, 12 characters (`segmentStore.ts`, `core/episodeScript.ts`). `podcast.yml` calls `audio.yml` after an episode commit (D128). A changed voice, model or language gives a new hash and narrates again. Every request pins `language` to en-US (2026-10-25): left out, Speechify detected it per segment, and a segment with a foreign name came back in another prosody, heard as the voice changing pitch.
- Briefings are pre-narrated by `audio.yml` after each run.
- A finished episode is also stored once as `audio/<ep-id>/episode.<hash>.m4a` (Opus in MP4, the turns joined) with a manifest of each turn's offset beside it; the lookup names both, the page reads the manifest first and plays the file when the browser decodes it, else the MP3 turns. Live catch-up stays on MP3 turns.
- A new episode can be heard from a live copy in Blob while it is written (D105).
- Mobile interface sounds unlock on click and play through the iOS silent switch (D105).

### Voices
- `GET /api/voices` lists voices (with the voices Default stands for, so it reads "Default (Name)"); each option leads with its accent's flag (Windows shows the two letters).
- A sample plays through `GET /api/voice-sample`, which serves only samples in the voice list and answers byte ranges (D62).
- Choosing a voice on `/settings/voice` or Catch up plays its sample; the Sample chip plays it again or stops it.
- A discussion's second voice defaults to `dominic_32`.

### Budgets
- Three narrations a day (`NARRATE_DAILY_CAP`, `apps/web/src/server/limits.ts`) and the budget counters are enforced; a prewarm on the site spends one of the three (D82), while pre-narration in `singularity publish` counts against the monthly Speechify budget only (D128); Play never asks for anything (no passphrase, D160).
- `POST /api/narrate` takes the shared burst cap (bucket `narrate`, D150) once the origin and body pass and before the store is opened; past it the answer is 429 `cooldown` until the minute ends.
- Speechify client tests run through an in-memory fake fetch.

## Code
- `apps/web/src/narration`
- `apps/web/src/server/narrate.ts`
- `apps/web/src/server/narrationState.ts`
- `apps/web/src/server/voices.ts`
- `packages/engine/src/audio`
- `.github/workflows/audio.yml`
