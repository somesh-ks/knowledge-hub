# Engine

Fetch, judge, write, validate, sizing and spares, sources and scores, cost limits. What it does now. Reasons: D42, D55, D66, D69, D70, D80, D103, D104, D108, D118, D119, D120, D204; history: docs/history/.

## Requirements

### Pipeline
- The engine runs on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Claude, Gemini fallback), validate, commit as the owner. Digest, state and config commits go through the write guard.
- One Jev request per item (D42). Scores are the filter and the ranking. Thresholds 0.4 (qualify) and 0.5 (grounding) are uncalibrated. The grounding check asks one yes or no per summary sentence against a 160-word excerpt headed by the title and outlet, and cuts an unsupported sentence; the story goes only when none is left (D204).
- Jev 1.14.0 is pinned (D118). From ten votes and opens, Jev asks of the top 60 candidates whether the owner would want each; the answer moves the score at most 15%, in place of the source-vote nudge. Votes nudge ranking from 3 votes in 30 days (first guesses).
- Models: `config/models.json` routes each step to a chain of families: judge, taste, format jev, flash-lite; emoji jev (2.5 s), flash-lite (1.5 s, any one RGI emoji, fallback id, site request); grounding jev, flash; facts flash-lite, flash; writer and script sonnet, flash (D181); transcription flash-lite, flash. `llm/modelResolver.ts` takes the newest listed id per family at run start, else `fallback_id`; `pin` overrides. `llm/modelRouter.ts` `callModel` moves on after an error, timeout, refusal or bad reply, warns and counts `model_fallback`; the ledger names the serving model. Claude gets `output_config` effort and format; no model gets temperature. Topic fit has no fallback.
- Writer: opens on the news, says at most two numbers, varies endings, puts a catch before the last line, sees the episode's other headlines, and writes a `chapter` label per story. One telling per story (`score/sameStory.ts`) (D119).
- Top picks are always included (D39). Each topic's best story airs first. Patch releases never air.
- Release news: library, framework and changelog stories (a release note or a judged developer tool launch) take at most 6% of the selected stories (about a tenth of what airs), are never Top picks, and are filed in the Launches section, which reads last in briefings, weeklies and custom episodes.
- A blocked outlet is cut on every fetch path; matching reads the item's URL (D108). Votes nudge ranking, the Firecrawl listing order and the writer.
- Regenerate replaces a digest over its own window (`singularity run --replace`); `--delete` removes a digest and its timeline (D104). Regenerate may choose topics again (D109).
- Ingest (D233), three times a day beside the daily fetch: free sources only; a new story's text goes to Blob under a random key, a row to Neon. No briefing reads it yet.
- `episode-eval.yml` (`eval` label, D180) scores main's writer against the branch's on frozen replays.

### Sizing and spares
- A briefing is sized by the owner's length alone at 1,066 spoken characters a minute (measured; podcasts 968) and airs the best survivors until their measured narration fills it (D119), at most 48 stories.
- A sized pass sends the judge 2.4 candidates per story it writes (192 for a 15-minute weekly, 68 for a 5-minute daily), writes 85% spares up to 80 and cuts to the narration limit after trimming spares.
- A pass left short (or under the floor) refills once, best effort, from `reserve.json` (what a doubled selection adds): `refill_written`, `refill_kept`. Guards: [resilience](../engineering/generation-resilience.md); numbers: [metrics](../engineering/metrics.md).
- General topics: Science takes a clearly on-topic story from one outlet (D120); the other general topics need two. General feeds are judged by Jev each run for the feeds' scores and never reach a briefing as such (D66); a general section gets two stories outside the briefing's cap; the weekly ceiling is 600 judged items.
- Weights (D124): five stops (`WEIGHT_STOPS`); weight 0 (Off) never publishes, in selection, render, validate and curate, which read resolved weights; `singularity learn` moves one stop.
- Mix and lean (D124): `format_mix` (Off, Less 0.85, Normal 1, More 1.1, Most 1.2 by source format; Normal omitted). One mix for every topic (`preferences.format_mix`), applied to each story's score (`applyFormatMix`); Off keeps the story out. A general topic's `perspective` (-2 to 2) scales a story by up to 15% by its outlets' mean `lean` (unrated is Centre) and removes none. At most two stories per outlet, by the story's host, outside sections of their own (`OUTLET_CAP`, `over_outlet`). `classify-formats` and `classify-lean` ask Jev for review. `curate` (agent mode) ignores the mix, as it ignores custom topics.

### Sources and scores
- A YouTube channel is added from a `/channel/UC...` address, a `@handle` or a `/c/` name (the id comes from the address, YouTube's resolver, then the page); a video address is refused with a message. A social media page with no feed is refused, as Firecrawl cannot read it.
- A YouTube finalist is read as text (`extract/youtubeText.ts`): youtube.com's subtitles (free, refused to datacenters), else Firecrawl's transcript provider (one scrape request and about 5 credits a video from the run's budget, D165), else Gemini transcribes 30 minutes by URL (3 a run), else its description, or nothing under 200 characters. Cached in `state/video-text.json`.
- Trusted publishers (D234, off): [list](trusted-publishers.md).
- A source's score is out of 5 (D103) from health, quality and trust, combined as a geometric mean (D55). New: under 10 judged items. Trust "not measured yet": under 10 checked items.
- A scoring sample judges up to 200 items a run for scores alone (left-overs of sources under the bar, a new source's recent posts from its own feed, switched-off feeds weekly), so every source reaches a score (D70). The report has `sample_items` and `sample_fresh`.
- A source with nothing that could have been published is scored on its pass share alone; one whose feed held under ten posts when read is scored from 3 judged items.
- A feed of general topics alone counts stories another outlet also carried; other sources count published ones (D66).
- D69: each general topic has five or more outlets: 30 desk feeds on, plus France 24 and six top-stories feeds (off) under World. Trending is off and its seven outlets feed World. The Guardian answers Firecrawl's US address with its US-edition feeds.

### Cost limits
- Firecrawl: 300 requests in any 7 days (cost ledger), 60 a run (D166, D222); listings up to 55%. A cached scrape is billed (`maxAge` saves time only).
- A finalist still thin after the feed text, the free page read and the Firecrawl scrape (under 600 characters) gets Alexandria facts (`alexandria/alexandria.ts`, `config/alexandria.json`): free discovery, then one text capability. Facts enrich read text only (none: dropped). Caps: 30 credits a run, 10 a story, 20 s a story; off without `FIRECRAWL_API_KEY`.
- Caps, cooldowns and the narration budget are the only limits (no passphrase, D160).
- The site's GitHub token reaches the repository for Create, Generate and config saves. `config.yml` runs share the `singularity` group.
- Vercel Cron calls `/api/cron/run` every hour (D61); it dispatches `run.yml` in the schedule's hour when the date gate says something is due, and needs `CRON_SECRET` (503 without it, 401 for an unsigned call). `RUN_CRON` (`13 7 * * *`) only picks GitHub's fallback entry, hours late since 2026-08-26. A cron-started briefing counts toward Generate's limits.
- `MAX_TEXT_CHARS` is 10,000 per story.
- A script attempt stops after 8 minutes (D80).

## Code
- `packages/engine/src/run`
- `packages/engine/src/fetch`
- `packages/engine/src/judge`
- `packages/engine/src/score`
- `packages/engine/src/write`
- `packages/engine/src/validate`
- `packages/engine/src/profile`
- `.github/workflows/run.yml`
