# Engine

Fetch, judge, write, validate, sizing and spares, sources and scores, cost limits. What it does now. Reasons: D42, D55, D66, D69, D70, D80, D103, D104, D108, D118, D119, D120; history: docs/history/.

## Requirements

### Pipeline
- The engine runs end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Claude, Gemini fallback), validate, commit as the owner. Digest, state and config commits go through the write guard.
- One Jev request per item (D42). Scores are the filter and the whole ranking. Thresholds 0.4 (qualify) and 0.5 (grounding) are uncalibrated. The grounding check asks one yes or no per summary sentence against a 160-word excerpt and drops stories that fail after a rewrite.
- Jev 1.14.0 is pinned (D118). From ten votes and opens, Jev asks of the top 60 candidates whether the owner would want each; the answer moves the score at most 15%, in place of the source-vote nudge. Votes nudge ranking from 3 votes over 30 days; both numbers are first guesses.
- Models: `config/models.json` routes each step to a chain of families (only jev, Sonnet, Haiku, Flash, Flash-Lite): judge, taste, format, emoji jev, haiku, flash-lite; grounding jev, flash, haiku; writer and script sonnet, flash; transcription flash-lite, flash. `llm/modelResolver.ts` takes the newest listed id per family at run start, else `fallback_id`; `pin` overrides. `llm/modelRouter.ts` `callModel(step, input)` moves on after an error, timeout, refusal or bad output, warns and counts `model_fallback`; the ledger product is the serving model. Claude gets `output_config` effort and format; no model gets temperature. Topic fit has no fallback yet.
- Writer: opens on the news, says at most two numbers, varies endings, puts a catch before the last line, sees the episode's other headlines, and writes a `chapter` label per story. One telling per story (`score/sameStory.ts`) (D119).
- Top picks are always included (D39). Every topic's best story airs first. Patch releases never air.
- Release news: library, framework and changelog stories (a release note, or a story judged a developer tool launch) take at most 6% of the selected stories (about a tenth of what airs), are never Top picks, and are filed in the Launches section, which reads last in briefings, weeklies and custom episodes.
- A blocked outlet is cut on every fetch path; matching reads the item's own URL (D108). Votes nudge ranking, the Firecrawl listing order and the writer.
- Regenerate replaces a digest over its own window (`dispatch run --replace`); `--delete` removes a digest and its timeline (D104). Regenerate may choose topics again (D109).
- `episode-eval.yml` scores main's writer against the branch's on frozen replays and prints the judge's reasons (`loop/inspect.ts`).

### Sizing and spares
- A briefing is sized by the owner's length alone (no 12 or 18 cap) and airs the best survivors until their measured narration fills the length, so a grounding drop does not shorten it (D119). The digest airs at most 48 stories.
- A sized pass sends the judge 2.4 candidates per story it writes (178 for a 15-minute weekly, 60 for a 5-minute daily) and writes 85% spares up to 80 stories. The narration-limit cut waits until the spares are trimmed to the length.
- Writing, grounding and validation drop about 45% of candidates.
- General topics: Science takes a clearly on-topic story from one outlet (D120); the other general topics need two. General feeds are judged by Jev each run for the feeds' scores and never reach a briefing as such (D66); a general section gets two stories outside the briefing's cap; the weekly ceiling is 600 judged items.
- Weights (D124): five stops (`WEIGHT_STOPS`); weight 0 (Off) never publishes, in selection, render, validate and curate, which read resolved weights; `dispatch learn` moves one stop.
- Mix and lean (D124): `format_mix` (Off, Less 0.85, Normal 1, More 1.1, Most 1.2 by source format; Normal omitted). Design, AI and Technology keep one mix on the group's home topic (`groupHomeId`), applied to built-in categories and grouped topics (`applyGroupMix`); Off keeps the story out of the group. A topic apart applies its own after weight x fit. A general topic's `perspective` (-2 to 2) scales a story by up to 15% by its outlets' mean `lean` (unrated is Centre) and removes none. At most two stories per outlet, by the story's host, outside sections of their own (`OUTLET_CAP`, `over_outlet`). `classify-formats` and `classify-lean` ask Jev for review. `curate` (agent mode) ignores the mix, as it ignores custom topics.

### Sources and scores
- A YouTube channel is added from a `/channel/UC...` address, a `@handle` or a `/c/` name (the id comes from the address, then YouTube's resolver, then the page); a video address is refused with a message. A social media page with no feed is refused, as Firecrawl cannot read it.
- A YouTube finalist is read as text before the writer sees it (`extract/youtubeText.ts`): its subtitles from youtube.com's player API, Android client, no key; with none, Gemini transcribes the first 30 minutes by video URL (`GEMINI_API_KEY`, the transcription chain, 3 per run); if both fail, its description, or nothing under 200 characters. Cached in `state/video-text.json`.
- A source's score is out of 5 (D103) from health, quality and trust, combined as a geometric mean (D55). New: under 10 judged items. Trust "not measured yet": under 10 checked items.
- A scoring sample judges up to 200 items a run for scores alone (left-overs of sources under the bar, a new source's recent posts from its own feed, switched-off feeds weekly), so every source reaches a score (D70). The report has `sample_items` and `sample_fresh`.
- A source with nothing that could have been published is scored on its pass share alone; one whose feed held under ten posts when read is scored from 3 judged items.
- A feed of general topics alone counts stories another outlet also carried; other sources count published ones (D66).
- D69: each general topic has five or more outlets: 30 desk feeds on, plus France 24 and six top-stories feeds (off) under World. Trending is off and its seven outlets feed World. The Guardian answers Firecrawl's US address with its US-edition feeds.

### Cost limits
- Per-run Firecrawl ceiling of 30 (D42); the listings use up to 16 requests. Firecrawl bills a cached scrape, so `maxAge` saves time, not credits.
- A finalist still thin after the feed text, the free page read and the Firecrawl scrape (under 600 characters) gets Alexandria facts (`alexandria/alexandria.ts`, `config/alexandria.json`): free discovery, then one text-only capability. Facts only enrich read text (a story with none is still dropped). Caps: 30 credits a run, 10 a story, 20 s a story; off without `FIRECRAWL_API_KEY`; a failure leaves the story as it was. Credits are in the cost ledger (firecrawl, alexandria).
- Caps, cooldowns and the narration budget stay enforced; the passphrase step is off (D41).
- The site's GitHub token reaches the repository for Create, Generate and config saves. `config.yml` runs share the `dispatch` concurrency group.
- Vercel Cron calls `/api/cron/run` every hour (D61); it dispatches `run.yml` in the schedule's hour when the date gate says something is due, and needs `CRON_SECRET` (503 without it, 401 for an unsigned call). `RUN_CRON` (`13 7 * * *`) only picks GitHub's fallback entry, which GitHub has started hours late since 2026-08-26. A cron-started briefing counts toward Generate's limits (one per 6 hours, three per 24, `apps/web/src/server/limits.ts`).
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
