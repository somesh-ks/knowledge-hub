# Decisions: engine

The pipeline that writes a briefing: sources, judge, writer, models, selection, scheduling, costs and the guards on a run. Rules and the Index are in [README.md](README.md).

## D3: Judge is TypeSafe Jev, writer is a cheap Nebius model chosen by a bake-off

- Date: 2026-10-05
- Status: The Jev judge stands. The writer-model half is superseded by D24.
- Decision: Typed judgments (category, craft depth, hype, sponsorship and funding flags, grounding checks) come from TypeSafe Jev. Summaries come from the cheapest Nebius model that clears the quality bar on a golden set, starting with Qwen3-32B (history: see D24). A Nebius judge stays wired as the fallback.
- Reason: Jev returns calibrated probabilities, so near-ties are handled honestly and weights can change without new calls. Writing cost is negligible at this volume, so the writer is chosen on quality and reliability with price as the tie-breaker.
- Rejected: One frontier model for both roles (more cost, no probabilities). A Nebius-only judge as the default (JSON answers without calibrated probabilities).
- Revisit if: Jev is repriced, rate-limited or withdrawn; revalidate quarterly.

## D6: Daily cron with a calendar-date gate, plus a Sunday weekly pass

- Date: 2026-10-05
- Status: Decided
- Decision: The schedule fires daily at 07:13 Europe/Stockholm. A regular digest is due when the Stockholm calendar date is two or more days after the last regular digest. On Sundays a weekly pass runs after the regular one.
- Reason: A delayed cron still lands on its own date, so drift never costs a cycle. 07:13 avoids the delays GitHub applies at the top of the hour.
- Rejected: Day-of-month `*/2` (resets at month end). A 07:00 cron (top-of-hour delays).

## D12: Voice limits confirmed

- Date: 2026-10-06
- Status: Confirmed as specified in build-plan Section 7.6
- Decision: Headline 12 words, summary 35 words and two sentences at most, why 18 words and one sentence, 8 to 12 items in a regular digest, floor 3, cap 12 (weekly 18).
- Reason: These hold the brevity bar: about two minutes to read and four to listen.
- Rejected: Looser limits, which let digests grow past the time budget.

## D21: Source health lives in state

- Date: 2026-10-06
- Status: Confirmed
- Decision: Per-source consecutive failures and last success are stored in `state/source-health.json` and overlaid onto the registry when it is loaded. `config/sources.json` holds only hand-edited configuration.
- Reason: The write guard lets `run` change only `Digests/` and `state/`, and a run must not rewrite configuration the owner edits by hand.
- Rejected: Failure counters inside `config/sources.json` (the earlier design), which the guard would refuse and which would mix automated churn into reviewed configuration.

## D23: The engine tolerates audio failure

- Date: 2026-10-06
- Status: Confirmed
- Decision: When narration or the Blob upload fails, `dispatch publish` leaves the digest's `audio` as `null` and exits without failing, so the text digest ships. The next audio run narrates every digest that still lacks audio, and `run.yml` calls `audio.yml` while any digest from the last 7 days lacks it (D25).
- Reason: The briefing is read first. Audio is added to text that already exists, so a speech outage must not cost the day's digest.
- Rejected: Failing the run on a speech error. Holding the digest until audio exists.

## D24: The writer model is picked from the live Nebius list

- Date: 2026-10-06
- Status: Confirmed. Supersedes the writer half of D3.
- Decision: No model id is the default. List the models your key can use with `dispatch models`, verify the ids with `dispatch doctor --online`, compare candidates with `dispatch eval --yes --only bakeoff`, then set `DISPATCH_MODEL` and `DISPATCH_FALLBACK_MODEL`. Qwen3-32B is history.
- Reason: Qwen3-32B left Nebius's serverless tier on 2026-08-31, so any named default goes stale. Nebius's baseline limit is 60 requests per minute, which the fallback judge's batching respects.
- Rejected: Another hardcoded default (the same failure at the next retirement). Moving the writer to another provider (the Nebius account and credit exist, D13).
- Revisit if: Nebius changes its tiers or limits again.

## D34: Stories are told in four beats; the why line is no longer written

- Date: 2026-10-08
- Decision: A story is a headline of at most 12 words and a summary of three or four sentences, 25 to 80 words: what happened, one number, why it matters, the catch from the source. Two sentences are accepted so a thin source is not padded. `why` stays optional in the schema so old briefings parse. Supersedes D12.
- Why: the owner wanted to understand a story cold, in the register of The Friday Checkout. Two sentences left no room for the number or the catch.
- Rejected: a required fifth field; migrating old briefings.

## D35: A Tech releases section, ranked by launch scale, with its own allowance

- Date: 2026-10-08
- Decision: Category `consumer_tech_releases` feeds a Tech releases section of up to 5 stories on top of the cap, never promoted to Top picks. The judge answers a five-level `launch_scale` question, used as the depth factor with a floor of 0.35. Tech-hinted sources get their own prefilter pool, ranked by how many outlets cover the same launch (`dedupe/storyCluster.ts`). Aggregated items are credited to their publisher.
- Why: launch news shows no technique, so craft depth scored every launch at the floor and the keyword prefilter dropped it first.
- Rejected: sharing the cap of 12; scoring tech by craft depth; a model call to rank launches before the judge.
- Cost: both question hashes changed, so the first run re-judges every cached item once.

## D36: Topics and sources are data the owner edits from the app

- Date: 2026-10-08
- Decision: `config/topics.json` holds the built-in categories and any topic the owner adds. A custom topic is judged by a Jev fit question built from its name and description, cached per topic in `state/topic-judgments.json`, scored as weight times fit, and gets its own section. The built-in category question and its hash are untouched. Sources gain an overlay, `config/sources.user.json`, so regenerating the registry never clobbers app edits. `dispatch sources suggest` finds feeds for a topic through Exa, validates them, scores them, and adds the top three on probation. The app edits config by dispatching `config.yml`, which runs `dispatch config apply` and commits through the write guard.
- Why: a new topic must not need a code change, and a Contents-write token on Vercel would be a far larger blast radius than dispatching a workflow.
- Rejected: one enum option per topic (re-judges everything on every edit); committing from the function.
- Cost: an edit takes about a minute to show, since the site is rebuilt.
- Status: unverified live (Jev fit questions, Exa discovery, the workflow).

## D39: Five topics, Top picks always included, General and Customized audiences

- Date: 2026-10-08
- Decision: Sections are Top picks, Design, Design Engineering (`ui-craft`), AI Products (`ai`), Tech Product Launches (`tech`) and Trending. `research`, `launches` and `watch` stay known ids with their old titles so published briefings render, but receive no stories: HCI research goes to Design, developer tool launches to Design Engineering, a video to the section of its topic. Design and Trending ship with the app as topics with origin `app`: judged by the D36 fit question, switchable off, not removable, not counted toward the 12 custom topics. Design has five feeds, Trending seven (`APP_TOPIC_SOURCES` in `sources/seed.ts`). `config/source-catalog.json` offers about 44 feeds to the add-topic flow; nothing in it is fetched until added. A podcast request gains `audience`: `general` explains terms and drops shorthand, absent means `custom`. Every episode includes the window's Top picks whatever topics were chosen.
- Why: the old topic names were vague, and a casual listener needs a mode that does not assume a design engineer.
- Rejected: moving old digests to the new sections; a Firecrawl source for either new topic.
- Cost: Design adds 5 and Trending 7 feed fetches a run (12 total, no Firecrawl); up to one extra Jev request per gated item for each shipped topic. Category question hashes are unchanged.

## D40: Trending is ranked by coverage; discovery only suggests

- Date: 2026-10-08
- Decision: Trending sources are tagged `trending` and enter no other section. `clusterStories` has a second `news` profile (names and numbers weigh double, 48 hour window); the number of distinct outlets is `signals.coverage`. One outlet never qualifies (prefilter drops it; `coverageFactor` is 0). Score is weight x fit^1.5 x coverageFactor (0.7 at two outlets, 1 at four). Trending has the D35 allowance of 5 on top of the cap and is never a Top pick. Coverage is computed by code; the only model call is the existing fit question, which also rejects non-news. `dispatch sources suggest` now records up to six candidates as `suggested` and adds none; old `added` entries still parse. `dispatch config apply --op` accepts one op or an array of 1 to 8 (`ConfigOpBatch`), validated whole, applied in order, all or nothing, one commit.
- Why: coverage is the honest signal for "trending" and costs nothing; auto-adding sources was noise and risk the owner did not ask for.
- Rejected: a model call to rank stories; Google Trends as a signal.

## D42: One Jev request per item, and a per-run Firecrawl ceiling

- Date: 2026-10-08
- Decision: An item that needs the six main questions and topic-fit questions gets one Jev request with both sets (`judge/combinedJudge.ts`); the answers are split into the same cache entries as before, so no hash changed. An item from a source tagged for a coverage topic (Trending) with no category hint is asked only its fit question and scored with a neutral main judgment that is never cached. Firecrawl is held to 30 requests a run (`fetch/firecrawlBudget.ts`): 16 for listing pages, the rest for scrapes. Listing sources over the allowance wait, oldest `last_ok` first, so the skipped set rotates, and the skip is recorded. The weekly pass reuses the regular pass's pages. The scrape fallback runs only for selected items and not when 600 characters are already in hand. A 429 backs off; three stop Firecrawl for the run. Requests per service go to `.cache/run/spend.json`, the run report and `state/last-run.json` (`spend`).
- Why: the owner asked to keep paid calls low without losing curation quality.
- Rejected: sharing one request across items (Jev takes one item's state); cutting sources.
- Cost: a Trending item loses the hype, sponsored and funding penalties; an item with 200 to 599 characters of text no longer gets a paid scrape; a Firecrawl source skipped for the ceiling waits a run.

## D43: General episodes are built from general-news feeds, ranked by coverage

- Date: 2026-10-08
- Decision: a request with `audience: "general"` takes `topic_ids` only from `GENERAL_TOPICS` (world, business, technology, science, culture, sports; validated in core) and is built from `config/general-feeds.json`: 3 or 4 open category feeds per topic (NPR, ABC, CBS, Sky, PBS, BBC, Al Jazeera, ScienceDaily, ESPN, The Guardian), read with the engine feed reader, kept inside the request window (feeds hold a day or two; a longer window is not an error), clustered across outlets with the `news` profile of `clusterStories`, ranked by outlets covering the story, then recency. The top stories across all chosen topics (a quarter of the length, 1 to 4) open the episode; the other slots go round-robin to the topics. Story text is the feed title and description. No briefing story, Jev, Exa or Firecrawl: the one model call is the script writer, with the D39 `general` prompt and the same number check. If every feed fails, or fewer than 3 stories are found, the run fails with a plain message and never falls back to briefing stories. `custom` and absent audiences are unchanged. Also for both kinds: the writer is asked for 90 to 100 percent of the length and a reply under 80 percent is sent back (up to 3 calls), then kept with `short_by_chars` recorded; a chosen topic with no story in the window is named in the result, and a request whose topics all have none fails instead of becoming a top-picks-only episode.
- Why: the owner wanted General mode to cover the topics of a general news podcast, with few sources so there is no noise and no Firecrawl rate limit.
- Cost: 4 to 24 feed fetches and one writer call per episode (up to 3 when the script is short); no key beyond the writer.
- Rejected: briefing stories for General; scraping or search sources for general topics; a model call to rank or summarise stories.

## D46: The writer's provider and model are chosen in Settings

- Date: 2026-10-09
- Decision: the provider (Nebius, the only one) and the model of the writer live in `config/writer.json`, written by the `writer.set` config op from Settings, Model. A missing or unreadable file means "Automatic". The engine tries, in order and without repeats, the Settings model, `DISPATCH_MODEL`, then `DISPATCH_FALLBACK_MODEL`; a Settings model that fails for any reason falls through. The live list comes from `GET /api/models`, a site function that asks Nebius with a server-side key and is cached for an hour.
- Why: the owner asked to pick the model, and the provider, from the app. D24 already said model ids change and must come from the live list; this puts that list where the choice is made.
- Cost: the provider key must also be on Vercel, a second place to rotate it. Until it is, the page offers the saved model and a typed id. One failed call on the Settings model moves the rest of that run to the environment's model.
- Owner: run `npm run secrets:push` once.
- Rejected: writing the `DISPATCH_MODEL` repository variable from the site (needs the token's Variables permission and gives no fallback); a list saved by the engine at each run (stale by up to two days, and a new file for the run's write guard to allow); a native select of sixty ids (no filter).
- Supersedes: the "set the two variables" step of D24 for choosing a model. The variables remain the fallback.

## D55: A source's score is out of 3: health, quality and trust, combined so a weak part cannot be bought back

- Date: 2026-10-11
- Decision: Each source's score is 0 to 3, from three parts of 0 to 1 (`packages/core/src/sourceScore.ts`).
  - Health: does the feed keep working? Failed fetches in a row (60%) and how recently a fetch last worked (40%).
  - Quality: is what it sends good enough to use? Three quarters yield (the share judged that passed, against a half, and the share published, against a quarter) and one quarter volume (items published in the 30-day window, against four).
  - Trust: the share of checked items the judge flagged as hype or sponsored, against a half: none flagged is 1, half or more is 0. Funding is a subject, not a trust problem, and is not counted. Only items that were asked the flag questions count: `asked` is the judged items less those that got a neutral topic-only judgment (the judge stage lists them as `neutral_ids` in `judged.json`), and `asked` and `flagged` sit in `state/source-stats.json`, halved with the 30-day window like the other counters. Under 10 asked items trust is "not measured yet" and the score comes from health and quality alone.
  - The score is three times the geometric mean of the measured parts, to one decimal (`combineScoreParts`, which the preview uses too): a weak part pulls it down more than a strong part lifts it, and a part at 0 makes it 0. Labels: Excellent 2.7, Good 2.1, Fair 1.5, Poor below. Under 10 judged items a source is New and has no score. Worked cases: healthy and clean with nothing published is 0.0 (Poor); 1 of 40 published is 1.7 (Fair); parts of 0.8 each score 2.4 while 1, 1 and 0.4 score 2.2; a clean source that passes half its items and never makes a briefing is 2.0 (Fair), kept on purpose, since its items clear the judge and lose only on the cap.
  - A row shows three pips filled to the score, the number and the label. The edit panel shows each part as a bar with two decimals (trust in words while it is not measured) and a sentence naming the weakest part. The Add source preview scores a site on the same scale from what one visit can tell: a valid, fresh feed for health (a page with no feed gets 0.3), posting frequency and a title for quality, https and a site that names itself for trust.
- Why: the owner asked for a score out of 3 that assesses a source's health, the quality of its content, its accuracy and whatever else matters. Health and trust are hygiene; quality is the value. Added up, the parts let a clean source that never reached a briefing score 2.0 (Fair) and one with 1 of 40 items published score 2.2 (Good). The parts are complements, so they are combined as the UN's Human Development Index has combined its three since 2010, by a geometric mean. Accuracy in the strict sense (are the claims true) needs a fact check per item, which nothing in the pipeline does; the judge already flags hype and sponsorship per item, the measurable part of it, so the part is called Trust and says what it counts.
- Cost: trust is not measured for a source's first ten checked items after the deploy, nor ever for a source that only feeds a coverage topic (its items get only the fit question). Real stats began on 2026-10-09, so every source reads New until it has 10 judged items. The thresholds are a first guess.
- Reassess: once 20 or more sources have a score, compare the labels with the sources the owner would keep, and move the thresholds before the formula.
- Rejected: a sum of the parts (it trades hygiene for value); the weakest part alone (a source weak in one part would score the same as one weak in all three); a fact-check pass (a model call per item for one part of a score); stars (five of them read as a score out of 5).
- Supersedes: the 0 to 5 score of D49.

## D61: Vercel Cron starts the scheduled briefing in its hour; GitHub's schedule is the fallback

- Date: 2026-10-11
- Decision: `apps/web/vercel.json` holds 24 daily crons, `0 H * * *` for every UTC hour, all calling `GET /api/cron/run`. The route needs `Authorization: Bearer <CRON_SECRET>` and refuses every call while the variable is unset or shorter than 16 characters. It reads `config/schedule.json` on main; in the schedule's own hour, Stockholm time (the daily hour, or the weekly slot's hour on its day), it runs the engine's gate (`decideRun`, now exported as `@dispatch/engine/gate`) on `state/last-run.json`, and when a briefing or the weekly pass is due it dispatches `run.yml` with `mode: scheduled`. `run.yml` keeps its hourly entries and `RUN_CRON`: GitHub's late run is the fallback, and the gate ends it gated once the briefing exists.
- Why: GitHub has started scheduled runs 4 to 7 hours late, and dropped some, since 2026-08-26, for many repositories and with no fix (github.com/orgs/community/discussions/207346). Here the 07:13 Stockholm entry ran between 13:11 and 14:02 on each of 7 to 10 October, before and after the hourly entries existed. In that thread, moving the minute, recreating the workflow or using a new repository did not help; an outside trigger calling `workflow_dispatch` did. Vercel's Hobby plan allows 100 crons a project, each once a day and landing anywhere in its hour, so 24 cover every hour, and the route follows the hour chosen in Settings without a redeploy.
- Cost: the briefing starts anywhere in its hour (07:00 to 07:59), not at 07:13. A scheduled briefing is now a `workflow_dispatch` run, so it counts toward Generate's limits (six hours apart, three a day), which GitHub's schedule run never did; adding `run-name` to `run.yml` (a workflow change) would let the limits tell the two apart. One GitHub read every hour, two more in the slot. Vercel does not retry a call that fails to arrive; GitHub's late run covers that day. Owner step: put a random `CRON_SECRET` of 16 or more characters in `.env` and run `npm run secrets:push`; until then the route refuses calls and GitHub's late schedule still runs.
- Rejected: accepting more hourly entries in `run.yml` (each runner it starts costs a minute, and every entry is late); a third-party cron service (one more account holding a credential); a Claude routine as the trigger (a whole session per day for one request); waiting for GitHub to fix it (six weeks without a reply).
- Supersedes: D6's reliance on GitHub's cron for the time of day (its date gate stays), and D45's `RUN_CRON` as the trigger (it stays as the fallback).

## D66: General news topics are topics; their feeds are sources Jev judges every run, for scores and episodes only

- Date: 2026-10-11
- Decision: World, Business, Science, Culture and Sports are topics in `config/topics.json` with origin `general`: seeded and restored like Design and Trending, named after a section no digest has (`general`), depth `coverage`; renamable, rewordable and switchable, never removed. Their 20 news feeds (from the retired `config/general-feeds.json`; ids `<outlet>-<desk>`) are ordinary sources tagged with the topic, so the app turns them on and off, adds and edits them like any other. The four Technology desks became sources under Consumer tech releases, switched off. Each run reads the general feeds of the topics that are on (never in the weekly pass), keeps their stories beside the pool (`general.json`), and has Jev judge every story in one request: the topic's fit question and the hype and sponsored flags. The stories never enter the pool, so no digest, Top pick or weekly digest can carry them; a failure judging them never stops the briefing. A safety ceiling of 600 stories a run is logged when hit. `state/source-stats.json` counts them as other sources, plus `covered` (stories another outlet also carried, by the news clustering); for a feed of general topics alone the score's quality part counts covered where others count published. General episodes read the enabled sources of the chosen topics. A stored `technology` reads as `tech`.
- Why: the owner said the general topics and sources were not configurable, wanted everything configurable, and chose to have Jev judge every general story (over a sample of three per feed or health and coverage alone) so the feeds are scored on the same parts as their other sources.
- Cost: not measured (the sandbox could not reach the feeds): an estimated 150 to 400 more Jev requests a run, against 165 for the whole of the 9 October run (about 2 cents), so a few cents more a run. Scores read New until a feed has ten judged stories. Al Jazeera's world feed is also Trending's, so it is fetched twice. ScienceDaily left the source catalogue, as it is now a source.
- Rejected: sampling three stories a feed (the owner chose all); health and coverage alone (no quality or honesty); letting general stories compete for the briefing (it would change the briefing the owner tuned).
- Supersedes: D43's fixed feed list in `config/general-feeds.json`.

## D70: A scoring sample judges a few items a run for scores alone, so every source reaches a score, switched-off ones included

- Date: 2026-10-11
- Decision: Each run's first regular pass judges a sample of items for their sources' scores alone (`run/scoreSample.ts`). They are never in the pool, never published and never marked seen, so the briefing is the same as without them.
  - Left-overs: a switched-on source under ten judged items gets up to 4 of the items the prefilter left out of this run's pool.
  - Its own feed: such a source with a feed (RSS, Atom, GitHub releases) reads it itself at most once in 30 days. The first read looks 90 days back, so a new source has a score after its first run; later reads look 30 days back. It takes as many items as it lacks.
  - Weekly check: a switched-off source with a feed is read once a week and gives 4 items, and the read sets its health. A switched-off general news feed is read with the pass's general feeds and judged like them. A story only it carried waits behind every other under the general ceiling, and its outlet never raises a switched-on feed's coverage (`coverage_all` keeps the full count for the checked feed's own score).
  - The reads run beside the pass's own fetch, each with a hard timeout. A read counts as done when the judge answered every item it offered (an unanswered one is offered again next run); a switched-off general feed's check is done once tried. Without a Jev key the sample is not planned at all.
  - Limits: 200 items and 40 feed reads a run, the sources with the fewest judged items first; a feed failing its own fetch twice in a row is not refilled. An item already judged (in the judgment cache or seen.json) or in this run's pool is never sampled.
  - Judge: Jev alone, with no Nebius fallback, so an outage cannot spend the writer's token budget; without a Jev key the sample waits.
  - Counting: a sampled item counts as judged, passed (when it would clear the bar on its built-in categories), asked and flagged, and as `sampled`. The publish share is out of `judged` less `sampled`, since a sampled item could never be published. Quality is read on what could have been published and blended with the pass share alone by its share of the judged items: a source with no sampled items scores as before, one with nothing that could have been published (switched off, or not yet sent by the prefilter) on its pass share alone, so a weekly check can show it has earned a place, with no cliff in between. `sampled_at` records the last read of the source's own feed.
  - A source whose feed held fewer than ten posts when the sample last read it to fill it up (`feed_posts`, set by every read that worked and standing for 60 days, one missed monthly read of slack) posts too rarely to reach ten judged items: from 3 judged items it is scored on what it has, and the reason says so.
- Why: the owner asked that every source, new ones included, get a score kept current on its factors. On 2026-10-11 only 10 of 149 switched-on sources had one: the prefilter sends the judge about 80 items a run, so most sources never reached ten judged items, and a switched-off source was never fetched at all.
- Cost:
  - At most 200 more Jev requests a run, about 2.4 cents at the 9 October rate (165 requests for about 2 cents). The backlog on 2026-10-11 was 88 feed reads and up to about 800 items, so about four runs at the ceiling, then far less.
  - The six switched-off general feeds add their stories to the general judging once a week.
  - The scores refresh on every run, not weekly: each run's counts land in the rolling 30-day window, and the weekly cadence applies to switched-off sources alone.
  - A sampled item is judged on the built-in questions only, without custom topic fits.
  - A sampled item that a later weekly pass's pool holds is judged from the cache but counted again. It is rare, and a fix would need a mark on every cached judgment.
- Rejected:
  - A weekly recompute of every score: scores already move every run, so it would make them older without producing new ones.
  - The fallback judge for the sample, for the token budget's sake.
  - Lowering the ten-item bar for everyone: the sparse rule covers the sources that can never reach it.

## D75: Suggested sources are chosen from the source catalogue when the page is built, with no live lookup and no scores

- Date: 2026-10-11
- Decision: A topic's page lists up to five sources from the catalogue that fit it, in the page itself (`SuggestedSources.astro`, `suggestSources` in `sourceCatalog.ts`). A feed must share a tag with the topic; its description and name only rank it. General topics match on their name alone. Each has a plus that adds it in the row. There is no `/api/topic-suggestions`, no skeleton, no "Live curated" mark and no score: a score the catalogue cannot have measured is not shown.
- Why: the owner saw the "Live curated" pill and a long wait for the list; the list was fetched after the page loaded, failed silently into a skeleton and showed scores made up for sources the engine had never judged.
- Cost: the list changes only with the catalogue and a redeploy; a source Jev has not judged shows no score until it has one.
- Rejected: caching the live fetch (it stays an unmeasured score); a loading state with a timeout (still a wait).
- Supersedes: the live suggested sources and their scores in D71.

## D108: A user profile with blocked domains and story votes

- Date: 2026-10-14 (owner: "a self-improving system tailored to a particular user", "make sure they are not sneaking into any more podcasts"; #97, #100, #103, #104)
- Decision:
  - `config/profiles/<user_id>.json` holds `user_id`, `blocked_domains` and `votes`. `ProfileStore.read(userId)` in `packages/engine/src/profile/profile.ts` is the one seam a user split has to change; the only user is `owner`. A missing file is an empty profile; a broken one fails the run.
  - Blocking: `profile.block` and `profile.unblock`. A URL is blocked when its host is a blocked domain or a subdomain of one. A registered source on a blocked domain is not fetched, and every fetched item (feeds, open search, listings, general feeds, the scoring sample, an episode's selection) is cut before dedupe, judging and extraction. The app offers it as "Stop hearing from {outlet}" on a story and as Settings, Topics and sources, Blocked outlets.
  - Votes: `profile.vote`, one stored vote per story, the newest 500 kept, the domain derived by the engine. A source's preference (ups minus downs, halving every 30 days, none under 3 votes) moves its items' ranking score by at most 15% either way; a domain's preference applies only where the source has none. When the Firecrawl listing cap forces skips, disliked sources are skipped first. The writer gets up to 5 liked and 5 disliked headlines as untrusted data, to choose what to lead with. The numbers live in `VOTE_LIMITS`. The run report has a `votes` line.
  - The app shows a vote only as the pressed state of its button, kept on the device (`dispatch:story-votes`). Votes are sent in one op when the page is hidden or left, or 10 minutes after the first unsent one, because every config save is a workflow run, a commit and a redeploy.
- Why: the owner wants briefings that learn from one listener now and from each signed-in listener later. Sources reach a briefing through open search as well as the registry, so a block has to act on items, not on the source list.
- Rejected: a separate blacklist of sources (it would repeat the source checkbox and miss open search), votes moving topic weights (too few votes to learn a weight from), votes kept in Blob (it needs a store credential or an address in the workflows; the profile's seam leaves the move open), sign-in now (digests and config are one repository built into one static site, so per-user briefings are a re-architecture).

## D113: Claude Sonnet 5.5 is the default writer; the Model list has no Default row

- Date: 2026-10-14 (the owner: "Glm 5.3 is set for nebius, by default I want sonnet 5.5"; #121, #124)
- Decision:
  - `DEFAULT_WRITER` (core) is Anthropic, `claude-sonnet-5-5`. The engine writes with it when `config/writer.json` is missing or broken, the page names it when nothing is chosen, and `config/writer.json` holds it.
  - Without `ANTHROPIC_API_KEY` the engine warns and writes on the Nebius models, so the default never stops a run.
  - The Model list has no Default (automatic) row: it shows the chosen model, under Top models and All models headings set in regular weight on the left. Switching the provider to Nebius starts on GLM-5.3 (`NEBIUS_DEFAULT_ID`) while the live list serves it, else the first model.
- Why: the page said one default and the engine used another (a missing file meant Nebius). A Default row named no model, so the owner could not tell what wrote an episode.
- Cost: a run without the Anthropic key writes on Nebius with a warning, not with what the page shows.
- Rejected: keeping the automatic row, which was the ambiguity.

## D117: live model lists, Claude ids checked on save

- Date: 2026-10-15 (the owner: "when newer models are updated on anthropic api or nebius, the list should instantly be updated"; then "Live-checked" on the save rule)
- Decision:
  - `/api/models?provider=anthropic` serves Anthropic's `GET /v1/models`, newest first; without it the picker offers the two built-in Claude models (`ANTHROPIC_MODELS`).
  - Both lists are held at the CDN for five minutes (`s-maxage=300`), not an hour, so a release shows within about five minutes.
  - Core accepts any well-formed `claude-` id, so the engine runs a model released after the built-in list. `/api/config` refuses one Anthropic does not list, after the passphrase; it answers 503 when the list cannot be read. The built-in two save without asking.
  - `ANTHROPIC_API_KEY` joins the Vercel environment (`npm run secrets:push`).
- Why: a hand-kept list of two ids went stale with every Claude release.
- Cost: saving a newer Claude model fails while Anthropic's list is down.
- Rejected: no CDN cache (every page load would call both providers); accepting any `claude-` id unchecked (the owner chose the live check).

## D118: Jev 1.14 pinned, and a taste check by Jev

- Date: 2026-10-15 (the owner: "keep a lean yet powerful mechanism for us. if you are using a llm, use a smaller model to keep costs low and accurate. using jev can also be useful with new jev upgrades (make sure we use that version)")
- Decision:
  - The judge, topic judge, general judge and grounder name `jev-1.14.0` (`DEFAULT_JEV_MODEL`). `jev-latest` still points to 1.13.0, and an alias moves without a code change. The SDK is 0.7.0.
  - A story opened at its source is stored as an open (`profile.opens`, newest 300). Opens wait on the device for a vote batch, or go alone once a day old, so they never cost a commit per visit.
  - From ten votes and opens, one Jev Noul per candidate (the top 60 by score) asks whether the owner would want it, given their newest liked, opened and disliked headlines. The probability moves the score by at most 15% either way and replaces the source-vote multiplier for that story; without an answer the source votes apply.
  - `loop/eval.ts` labels importance with the pinned Jev and once with `jev-1.13.0`, and reports how many labels moved.
- Why: votes keyed on source and domain miss what a story is about, and the judge never saw the owner's taste. Jev is the cheapest model here (USD 0.042 per million input tokens, output free) and returns calibrated probabilities, so no new LLM is needed.
- Cost: about 60 Jev requests a pass; the judgment cache is keyed by model, so every item is judged afresh once after the pin.
- Rejected: an LLM recommender or embeddings (one reader, too few interactions to tune); a discovery slot in selection (the taste check is neutral on unrated sources, and every topic already gets its best story first since #144); a store of its own for opens (every save is already a commit; riding the vote batch costs nothing new).
- Revisit if: the eval shows 1.14 moving many importance labels, or the taste check's answers sit near 0.5 for every story.

## D120: Science airs a one-outlet story

- Date: 2026-10-15 (the owner chose "Science only" on the decision card "Let a well-matched science story air when only one outlet carried it?")
- Decision: for the Science topic alone, a story carried by one outlet gets a coverage factor of 0.65 instead of 0 (`SINGLE_OUTLET_TOPICS` in `score/scoreTopics.ts`). A story the judge finds clearly about science (level 3) just clears the 0.4 bar; one loosely tied does not; a story two outlets carried (0.7) still ranks above it. World, Business, Culture and Sports keep the two-outlet rule.
- Why: Science never aired. Its feeds are mostly press releases that no second outlet carries (ScienceDaily sent 31 stories in a week, none twice), so every science story scored 0.
- Rejected: all general topics (World and Business are well co-covered and would gain single-source stories); wire-service science desks (big stories only); leaving it.
- Revisit if: Science airs press releases the owner does not want (raise the factor's bar or add a source rule), or another general topic stops airing for the same reason.

## D130: no Kimi, a benchmark-ranked five, a weekly check

- Date: 2026-10-21 (the owner: Kimi models are never offered)
- Decision: `EXCLUDED_MODELS` (`apps/web/src/lib/modelRank.ts`) removes the Kimi models. The Nebius top five (`NEBIUS_TOP`, `lib/modelId.ts`) follow EQ-Bench longform on 2026-10-21: GLM-5.3, GLM-5.2, DeepSeek V4 Pro 0813, DeepSeek V4.1 Flash, GLM-5.1. A scheduled check every Monday 08:52 Europe/Stockholm, in a fresh cloud session, re-ranks for the podcast use case (faithfulness first, then long-form spoken prose, instruction following and long context, then price), runs the repo's eval bakeoff when the provider key is there, and opens a PR labelled `review` when the list changes.
- Why: the list was a snapshot of a market that moves weekly; a person reading it should not have to remember to refresh it.
- Revisit if: the check's sessions cannot browse or open PRs. It was created without connectors; the owner recreates it from claude.ai with GitHub and Firecrawl connected.
- Check: the model tests cover the exclusion and the five.

## D134: no scheduled model check

- Date: 2026-10-21 (the owner: "I don't know what is this Monday model check. It shouldn't be connected to my Claude.ai account. If it is useful to this project, if not, then it can be removed")
- Decision: the claude.ai scheduled task of D130 is deleted and not replaced. The Settings model select still lists Nebius's live models; `NEBIUS_TOP` is refreshed by hand when a writer change is wanted.
- Why: a weekly cloud session on the owner's account to re-rank five entries costs more than a list that rarely changes, and it lived outside the repo.
- Revisit if: a better writer goes unnoticed for a month.

## D135: no batch API for the scheduled runs

- Date: 2026-10-21 (the owner: "using batched requests on the Anthropic API if it'll be useful, but you need to time it well")
- Decision: not built. The scheduled writer is Anthropic Sonnet (`config/writer.json`), but only the first writing pass is independent; grounding, rewrites and the script wait on it, all inside one job that must be listenable at 07:00. Batching would split the run into submit, wait and resume with a deadline fallback, for about $12 a month at today's volume (estimated, no token logs yet).
- Revisit if: volume grows about tenfold, the owner accepts an earlier start, or the cost ledger shows the writer as the main spend.

## D136: one model orchestrator, four model families

- Date: 2026-10-21 (the owner: "remove nebius, and just use Gemini and Claude models in good orchestration and not have model selector"; "Use jev, flash models from Gemini, and haiku and sonnet only. Never opus. Also upgrade the relevant models whenever there's a new model available of the same kind. Use jev and backup of Gemini flash or haiku"; "Temperature can be removed")
- Decision: `config/models.json` names, per step, an ordered chain of families: judge, taste fit, source format and topic emoji: Jev, Haiku, Flash-Lite; grounding: Jev, Flash, Haiku (a checker of another family than the writer); story writer, rewrites and the podcast script: Sonnet, Flash; transcription: Flash-Lite, Flash. A schema rule refuses any other family. At run start the provider model lists resolve each family to its newest generally available model (no preview, no Opus), falling back to a pinned id. `callModel(step, input)` moves on after an error, a timeout, a refusal or invalid output and logs every fallback. No request carries a temperature. Nebius, its keys, the Settings model select and `/api/models` are removed.
- Why: one provider fewer, a fallback that is never silent (a deprecated temperature once dropped the writer onto Nebius unnoticed), and models that improve without a release.
- Revisit if: an automatic upgrade changes tone or selection for the worse (pin the family in the routing file), or a family's price jumps.

## D137: a cost ledger, shared and per-user

- Date: 2026-10-21 (the owner: "a cost tracking engine to track costs in different time periods ... operating expenses per user when I expand my app to general public in different timezones"; "Cost analytics goes into a separate page /analytics")
- Decision: every paid call is a record (run, kind, the edition's timezone, user, provider, product, units, USD from `config/prices.json`, estimated or measured) in `state/costs-YYYY-MM.json`; a scheduled edition is shared by everyone in its timezone, an on-demand episode or a Play narration belongs to its user. `dispatch costs` totals by period and group; /analytics shows the same, linked from Settings.
- Why: per-user cost needs the split from the start; the marginal cost of a user is mostly what they ask for, not the shared briefing.
- Revisit if: the prices in `config/prices.json` (all unconfirmed on 2026-10-21) are corrected, or a second user arrives.

## D138: Alexandria enriches, never replaces

- Date: 2026-10-21 (the owner: "enrich the content with firecrawl Alexandria when needed"; "Alexandria just gives enriched information about certain things")
- Decision: when a finalist's text is under 600 characters after the feed, the free read and the regular scrape, the engine asks Firecrawl Alexandria for facts on its subject and appends them, labelled with their provider, to the material the writer and the grounding check read. Caps: 30 credits a run, 10 a story, 20 s a story. A story with no readable text is still dropped.
- Why: facts from a third party can fill out a thin story; standing in for an unread article would describe it from someone else's data.

## D155: Software Engineering is the owner's fourth topic, with its own section and an engineering-depth judge category

- Date: 2026-10-22
- Decision: a built-in group `software` (name Software Engineering, emoji 💻, home `software_engineering_depth`) with its own briefing section `software`, ordered right after `ui-craft` in `SECTIONS` (and in `config/topics.json`). It competes like Design and AI: no allowance of its own, no special cap. A twelfth category `software_engineering_depth` ("Engineering deep dives", craft depth, weight 0.85) is appended to `CATEGORIES`; `developer_tool_launches` homes to `software` too. The page `/settings/topics/software` has generated topic art; the two categories' old page URLs redirect to it.
- Release news unchanged: a story judged `developer_tool_launches` is still release news (6 percent cap, never a Top pick, Launches, read last), as the owner asked on 2026-10-15 and 2026-10-18. The branch first lifted the cap as a judgment call; review put it back, and moved the group's home to `software_engineering_depth` so an added source can lead. The prefilter lets a source hinted or tagged `software_engineering_depth` through as it does a Design-tagged one, unless that category is Off. A briefing dated 2026-10-22 or earlier keeps tool launches in `ui-craft` (`FORMER_HOMES`, validate). A preferences file without the new weight reads it at 0.85 (`ADDED_CATEGORIES`); any other missing weight still fails. A Create episode never matches release news (Launches), as before.
- Sources: `react-status` and `this-week-in-react` moved to `developer_tool_launches`; `cloudflare-blog`, `stripe-engineering`, `github-engineering`, `dan-abramov`, `kent-c-dodds` and `lee-robinson` to `software_engineering_depth`. Component libraries stay in Design, AI engineering writers in AI.
- Cost: the category choice gains an option, so the questions hash changes and the judge cache is asked again once. There is no extra call per item. The median weight is now the mean of the middle two of twelve.
- The Create panel has a Software Engineering chip, ticked by default like the other three.
- Revisit if: the Software section stays empty for a week (too few depth stories), or the owner wants tool launches to lead.

## D165: YouTube captions come through Firecrawl when YouTube refuses the runner

- Date: 2026-10-24 (the owner: "yt-dlp is a very reliable option, use this"; then "look into possible workarounds to make the youtube transcription extraction reliable")
- Decision: when youtube.com's player API refuses the run (it has refused GitHub's runners since about 2026-10-14), the extractor asks Firecrawl's Alexandria provider `youtube-com/videos/video_transcript` for the same captions. One scrape request a video from the run's Firecrawl budget (`FirecrawlGuard.relay`, so a video relayed once in a run is not paid twice), about 5 credits a video, metered in the cost ledger under firecrawl/alexandria. Order stays: cache, youtube.com (free), Firecrawl, Gemini (3 a run), the description. The method recorded is `captions`, as they are.
- Why: the block is on the address, not the tool. Measured from a datacenter address on 2026-10-24: the watch page answers 429 and every yt-dlp player client (default, tv, mweb, web_embedded) ends in "Sign in to confirm you're not a bot"; yt-dlp's maintainers say a PO-token provider does not lift that wall (yt-dlp #15865) and point to cookies. Firecrawl already holds a key, a budget and a ledger row here (D138), and its provider makes the InnerTube call our own code makes, from an address YouTube serves. Measured live the same day: a full transcript in one call.
- Rejected: yt-dlp with a Google account's cookies in a secret (works, but YouTube may flag the account for automated use, the cookies expire, and the workflow gains Python and a secret to rotate); a PO-token sidecar (does not answer the sign-in wall); a paid residential proxy (a monthly bill for one feature); a hosted transcript API (a new vendor and key for what Firecrawl already sells).
- Revisit if: Firecrawl's provider goes away or its price rises above a scrape's worth (then yt-dlp with a throwaway account's cookies is the next step, behind the same `relay` budget), or YouTube serves the runners again (then the free path answers first and Firecrawl is never asked).
- Amended 2026-10-30 (the owner: keep Firecrawl and Gemini by default): the free youtube.com attempt is removed, since no runner reached it. The order is cache, Firecrawl, Gemini. Reinstate it only with the Revisit trigger above.

## D166: Firecrawl gets 100 requests a week, at most 50 a run

- Date: 2026-10-24 (the owner: "change firecrawl budget to 100 per week")
- Decision: each stage reads the cost ledger for the Firecrawl requests (listing pages and scrapes) other runs made in the 7 days before this one, and holds the run to what is left, at most 50 (was 30, D42); listings keep 55% of a run's room. A failed run's spend goes to the ledger with its failure record. A listing source left out for the week says so in its note. A ledger that does not read, or a run with no start time, warns and leaves the run its own 50.
- Why: the YouTube relay (#235) and the article scrapes press on 30 a run. A weekly cap lets one run use more while the week stays at the owner's number; 50 is half the week, so one run can never spend it all.
- Not counted: Alexandria credits (their own cap of 30 a run, D138); dry runs, failed replacements and on-demand runs, which commit nothing; a cancelled or timed-out run, which skips its failure record. A ledger that does not read fails open (a warning, the run's own 50): a briefing without Firecrawl loses its YouTube feeds and scrapes.
- Revisit if: the owner's Firecrawl plan changes, or a week's ledger passes 100.

## D180: the episode eval runs only when asked, and on a pull request judges only the branch's rewrites

- Date: 2026-10-24 (the owner: "generating a podcast script shouldnt be this expensive as today", "especially anthropic api costs")
- Decision: `episode-eval.yml` runs when a pull request gets the `eval` label (re-add it to run again) or by hand, never on a push. On a pull request it judges only the four rewritten episodes (main's prompt and the branch's, daily and weekly); a manual run judges the fixtures and every replay as before.
- Why: it ran on every push to a writer, judge or `loop/` change, 12 times on 2026-10-24 (the rename and structure PRs), and each run made about 40 Sonnet calls on the API key: four replay rewrites and two scores of about 20 episodes, 16 of them fixtures and replays a pull request never changes. Estimated at $4 to $6 a run, in no cost ledger, against about $1.10 for a briefing run.
- Amends: D148's "`episode-eval.yml` runs only for the writer, the judges, the voice and `loop/`".
- Revisit if: a writer or voice change merges without an eval and an episode gets worse, or the eval's spend is recorded and found small.

## D181: Claude writes the scripts; Jev judges, Gemini backs it up

- Date: 2026-10-24 (the owner: "use jev mostly and use gemini models as backup. use anthropic models mostly for script generation")
- Decision: in `config/models.json` Claude Haiku leaves every chain: judge, taste fit and source format are Jev then Gemini Flash Lite, grounding Jev then Gemini Flash, fact extraction Gemini Flash Lite then Flash. Sonnet keeps the story writer, its rewrites and the podcast script. The story writer sends no effort (the model's default) and its rewrites medium, in place of #187's medium and low.
- Why: since #187 (2026-10-22) a daily run made 43 to 49 Claude calls, against 19 to 22 before, about 27 of them voice rewrites of one field each, every one resending the article (about 5k tokens). Weaker first drafts were the likely cause; a rewrite costs more than the thinking the lower effort saved.
- Later the same day: a voice rewrite sends the first 4,000 characters of its source, not up to 10,000 (`rewriteOnce.ts`); grounding repairs still send the whole text.
- Revisit if: the next runs' `lost_reasons` still show more than about 8 voice rewrites, when the per-field rewrites become one call per story.

## D183: The Costs page counts what Anthropic billed, not only what the app recorded

- Date: 2026-10-24 (the owner: "show all costs in the cost page including evals and others to get accurate cost")
- Decision: with `ANTHROPIC_ADMIN_KEY` set on Vercel, `/api/costs` reads Anthropic's cost report (Admin API, by UTC day, cached 10 minutes) and adds, per day, the billed total less the ledger's Anthropic records as one "Outside the app" record (kind `outside_app`, no run). Without the key the page says spend outside the app is not counted. Other providers stay metered.
- Why: the ledger sees only the app's own calls. The episode eval (estimated at $4 to $6 a run, 12 runs on 24 Oct) and local scripts reach the bill but never the page, so the page read far below the bill. The bill is the only source that catches spend nobody thought to meter.
- Revisit if: another project shares the Anthropic organization (the report covers the whole organization, so its spend would land in "Outside the app"), or Gemini spend grows enough to need its billing export.

## D190: votes tune topic weights and source scores through a bounded, decaying adjustment

- Amends: D108, D118.
- Amended by D194: the topic part (weight adjustment, the "Adjusted" mark) is removed; source score adjustment stays.

- Date: 2026-10-25 (the owner: "make sure topics evolve as models generate new podcasts. This should be refined and intelligently managed").
- Decision: a story vote moves an `auto_adjust` on its topic and its source in the owner's profile (`packages/core/src/autoAdjust.ts`, applied in `profile/autoAdjust.ts` by the same `profile.vote` op that stores the vote): 0.02 a vote, within plus or minus 0.2, halving over 30 days without votes, sources at a quarter of the step. Scoring reads the owner's weight plus the decayed adjustment (Off stays Off); the weight itself is never written. A weight row with a live adjustment says "Adjusted" (`lib/topicAdjust.ts`, WeightRow).
- Why: D108 kept votes out of weights so a bad week could not rewrite the owner's choices; a separate, bounded, decaying term keeps that guarantee and still lets the mix follow what the owner likes. The constants are first guesses, named in one place for tuning against real data.
- Rejected: writing the adjustment into the weight (the owner's setting would drift under them); a separate learn step (the vote op already runs on every batch and commits through the config store, D185).
- Revisit if: two weeks of votes show the step or the cap moving a topic further than the owner meant, or Jev's taste answer (D118) and this term pull apart.

## D194: topic weight is removed

- Date: 2026-10-26 (implementation plan v2, section 5, D-f).
- Context changed: topic weights were removed in implementation plan v2, so D190's per-topic vote adjustments no longer have an owner-set weight to adjust.
- Decision: a topic has no weight. Scoring uses `NORMAL_TASTE` (0.7) for categories and custom topics, 1 for general and Trending topics, and 0.85 for Design; the weight sliders, `weights.set`, the learn patch `weight_deltas`, the vote-driven topic adjustment and the "Adjusted" mark are gone. Old configs that carry `weights`, `topic.weight` or `auto_adjust.topics` parse and the fields are stripped. Vote-driven source scores stay.
- Why: fixed taste values remove per-topic tuning while preserving the shipped app and general topics' scoring strengths.
- Supersedes: D190 for topics.

## D197: a scheduled briefing is generated ahead and published at its hour

- Date: 2026-10-26 (#318, #349).
- Decision: the run for a scheduled briefing starts up to two hours before its hour, generates, and commits at `publish_at`, three minutes (`DEPLOY_LEAD_MS`) before the hour in Stockholm, so the deploy lands at 07:00. The cron's early slot keeps its own local date, and the store's timeout no longer counts the module load.
- Why: a run that starts at the hour published a quarter of an hour late, and a slow cold start could start it at the wrong hour.
- Revisit if: a run's work outgrows the lead.
- Amends: D61.

## D204: a short or lost run is guarded against, measured, and followed in one run card

- Date: 2026-10-27 (branch `ccr-d90138a8-9n397m`).
- Decision: (1) a push that conflicts on the cost ledger, timings, usage counter or run metrics merges them by id (`git/stateMerge.ts`) instead of failing; (2) grounding cuts an unsupported sentence before it drops a story, a section over its allowance gives up its lowest stories, and a writer batch that fails is written again in halves; (3) every briefing and episode records its funnel, length share and stage times (`state/run-metrics.json`, `podcast-timings.json`), `singularity metrics` reads them against targets (`metrics/summary.ts`) and `health` warns; (4) a Regenerate is followed in the same run card as a Catch up (strip above the bottom bar on a phone, card in the side column from 64rem), and a failed run says why in a sentence; (5) a Catch up selects half again as many stories as it airs and fills its slots after the structure's caps; (6) the length options stay 3, 5, 10 and 15 minutes.
- Why: the 2026-10-27 Regenerate aired 2 of 5 minutes (4 stories dropped, refill threw) and its Catch up lost a written episode to a rebase conflict on a ledger that both workflows append to; a stepper inside the Regenerate sheet duplicated the run card and could not show a failure. The 15-minute option already fills the 19,000-character request one narration takes, so a longer option needs chunked narration first.
- Rejected: choosing one side of a conflicting state file (loses records); editing `config/` in Git to raise the daily length (the store owns it, D149, D185; the owner raises it in Preferences); a Length control in the Regenerate sheet (needs `run.yml`, the engine and the server contract to change together).
- Revisit if: `singularity metrics` shows `length_share` under 0.9 or `failure_rate` over 0.1 across ten runs, or a longer option is wanted.

## D209: the lane is free while a briefing waits for its publish time

- Date: 2026-10-28 (the owner chose plan A after "Waiting for a slot"; Anthropic batch for the scheduled writer, an hour early with a fallback 15 minutes before publish; a story store by topic, for generation only).
- Status: planned, nothing built.
- Decision: `run.yml` holds the one `singularity` lane for the whole wait of a briefing generated ahead (up to 135 minutes, `MAX_HOLD_MS`), so a Regenerate or Catch up in that window queues (2026-10-27: run 461 behind run 459, 97 minutes). The plan, in order, one PR each: (1) the commit stage loads its config (sources, voice, topics, section plans) before the wait and fast-forwards the whole checkout to `origin/main` after it, so `state/` and `Digests/` come from the remote and the commit is a clean delta on what a push meanwhile committed (it read the checkout from job start; a config push is the same class as #303), while the selection is still built from the config it was validated against: fresh topics failed a finished briefing when a category was muted meanwhile (#399); a fast-forward that cannot run (a store-copied config file the incoming commits also change) keeps the checkout, and the push then falls to `commit.ts`'s rebase handling: `keepUpstreamConfig` takes the incoming copy only when every conflicting path is a snapshot file, and any other conflict fails the push, as before; (2) `run.yml` splits into a generate job (Gate to Validate, group `singularity`) that hands `.cache/run/` over as an artifact, a hold job with no group that only waits, and a publish job (Commit, group `singularity-publish`, seconds long) that checks out and installs the run's own commit (`github.sha`, never the branch head), so the code and dependencies match the artifact's producer, with the producing sha written into the artifact and a mismatch failing before the commit stage runs; only the data the stage reads moves, through step 1's fast-forward, after the code is loaded; so an on-demand run takes the lane at once and publishes at once; two runs now generate from the same `seen`, so the publish job drops selected items the refreshed `seen` already holds (an item an on-demand run published meanwhile), publishes the rest and records `nothing` when none remain, with a test where a concurrent push marks a selected item as seen; (3) the scheduled writer sends its first pass to Anthropic's batch API, which moves Validate behind the wait, because grounding needs the written stories: the generate job ends after submitting about 60 minutes ahead (Gate to the Write submit), the hold job with no group polls until the results are in or 15 minutes before publish and hands them over as an artifact, and a finish job (group `singularity-publish`, about 5 minutes: it writes what did not finish synchronously, runs Validate and commits) closes the run. At the cutoff the hold job cancels the batch and waits for its `processing_status` to reach `ended` (cancellation is asynchronous, so results read earlier would miss stories that were still finishing); the finish job takes batch results by story id, so each story is written once, writes synchronously only the stories with no succeeded result, discards any result that arrives later, and counts the batch's reported usage and the synchronous usage in the same spend line and token budget (step 4); requests in flight at the cancel may still complete and be billed, bounded by one write per story; step 2's layout (Validate before the hold) holds until then; Regenerate and Catch up stay synchronous; (4) cost is held at the run level, not per story: one generous reply ceiling per writer request instead of 800 tokens a story, the run's token budget and a spend line in USD as the backstop; (5) a 30-day store of stories by topic, filled by an ingest job, read by generation only.
- Why: the wait is the hold, not the work (an on-demand daily with no hold took 3 m 20 s, queued 2 s). The hold is already idle time, so a batch fits in it without D135's submit-and-resume split.
- Rejected: an own group for on-demand runs (two commits would both rewrite `seen`, `last-run` and `costs-*.json`, and `commit.ts` aborts on a rebase conflict, never forces; #391, still open, merges the cost ledger, timings, usage and run metrics on such a conflict, and its description lists neither `seen`, `last-run` nor the judgments, so step 2 builds on it and on its `run.yml` length input); a 30-minute job timeout (ends the hold, D197).
- Open before step 4: the reply ceiling is not what costs money. `THINKING_HEADROOM` (8,000) already sits on top of it, a tight ceiling once cut the writer's JSON off mid-object, and `TokenBudget.check` counts the ceiling in its estimate, so raising it alone trips the 400,000-token run budget sooner (the 2026-10-25 weekly wrote 403,000). `story_writer` sets no `effort`, so its thinking is billed as output. Measure stories written against stories aired, and the writer at lower effort on `loop/`'s replay, before the batch.
- Supersedes: D135 once step 3 ships (its revisit condition, an earlier start, is met, and the hold gives the batch its wait). Amends: D197 (the strict publish time stays; the hold no longer holds the lane).
- Revisit if: a held publish job is replaced while pending (GitHub keeps one pending run per group), or a batch misses 15 minutes before publish on more than one run in ten.

## D222: Firecrawl gets 300 requests a week, at most 60 a run

- Date: 2026-10-29 (decided for the owner by the coordinator while the owner is away; amends D166)
- Context changed: D166's 100 a week was spent by four runs in three days, which left every later daily with no Firecrawl room.
- Decision: `FIRECRAWL_WEEKLY_BUDGET` 100 to 300 and `FIRECRAWL_RUN_CEILING` 50 to 60; the listing share stays 55% (33 listings, more than the 17 listing sources).
- Why: the 100 is our cap, not the plan's. Four real runs (24 to 27 Oct) spent all of it, so the dailies of 28 and 29 Oct fetched no listing, relayed no YouTube feed and scraped no article, and 3 of 16 selected stories had no readable text. A daily asks for about 40 requests, a week about 150; 300 requests are about 0.25 USD at the ledger's price, and the Firecrawl account holds hundreds of thousands of credits (read 2026-10-29).
- Revisit if: a week's ledger passes 300, or the plan's credits run low.

## D223: Firecrawl's week alerts at 150 before the stop at 300

- Date: 2026-10-29 (builds on D222's 300 a week; the owner, 2026-10-28: "a high safety ceiling that alerts, not a hard cap"; made for him while the plan's Step 1 ran).
- Decision: a normal week stays 100 requests (D166) and the stop stays D222's 300 (`FIRECRAWL_WEEKLY_BUDGET`). Health warns (`firecrawl_week_high`) once the ledger's last 7 days pass 150, and faults (`firecrawl_week_stopped`) at 300, where runs stop listing through Firecrawl.
- Why: dry runs and regenerations spend the same week as the schedule, so a hard 100 was gone by Tuesday and left 15 listing sources skipped and 7 YouTube feeds failing for the rest of the week. A stop at three times normal still bounds a runaway; the alert says so before anything is skipped.
- Rejected: no stop at all (a loop or a mistaken monitor could spend the account); counting dry runs apart (they pay real credits).
- Revisit if: the alert fires in a week with no extra runs (normal has grown), monitors replace listing scrapes (Step 2), or a week goes from past 150 to the stop before the owner saw the warning (the warning reaches the owner only in the Monday `health-warnings` issue and `singularity health`, not the Health page; the stop opens a `health` issue only if it still stands when the daily check runs; a same-day warning is then the fix).
- Limit: the week is read from the ledger, and a failed dry run records nothing (`recordFailed.ts`), so its Firecrawl requests are not counted.
- Amends: D222 (adds the alert; the 300 and the 60 a run are D222's).
- Status: Superseded by D227 (the alert moves from 150 to 210).

## D227: Firecrawl's week alerts at 210, not 150

- Date: 2026-10-29 (the same day as D223; the owner asked for the open questions to be decided).
- Decision: `FIRECRAWL_WEEKLY_ALERT` is 210. Health warns (`firecrawl_week_high`) once the last 7 days pass 210. The fault at 300 and the 60 a run are unchanged.
- Context changed: D223 chose 150, but D222 measured a normal week at about 150 (a daily asks for about 40), so a 150 warning would fire every normal week and be ignored.
- Rejected: a same-day alert path (the 300 stop is the backstop; build it only if the stop is ever hit).
- Revisit if: the alert fires in a week with no extra runs (normal has grown), or monitors replace listing scrapes (Step 2).
- Supersedes: D223's threshold.


## D228: A failed dry run records its spend

- Date: 2026-10-29 (decided for the owner, who wants accurate cost data; D223's Limit).
- Decision: when a dry run fails, `run.yml`'s Record failure step runs with `--dry-run` and `recordFailedRun` puts the run's spend in the cost ledger in a commit of the ledger alone (`chore(costs): dry run <date> failed`), as a finished dry run does. The cadence, the metrics and the digests stay as they were.
- Context changed: a failed dry run pays for the calls it made before it stopped, so recording nothing left Firecrawl's week short.
- Why: Firecrawl's week (D222, D223) is read from the ledger, so the count was short by exactly the runs that were being fixed.
- Rejected: counting the run log's `pipeline_stages` instead (Neon, not the ledger the budget reads; a second source for one number).
- Limit: the ledger commit still refuses when the tree holds any other change (for example config copied from the store that git does not yet have), and a ledger write that fails is swallowed by design ("a ledger failure never fails a run"); either leaves that run's spend uncounted, and both only warn.
- Amends: D223 (removes its Limit; the alert is D227's now and the stop of 300 stands). A dry run's ledger commit, finished or failed, uses its own `costs` allowlist (`state/costs-*.json` only), not `publish`.

## D232: One cleaner turns scraped Markdown into prose

- Date: 2026-10-29 (Step 2 of the pipeline plan; the owner asked for "cleaner output to avoid unwanted html/scripts/etc.").
- Decision: `extract/cleanMarkdown.ts` is the one place scraped Markdown becomes text. It drops lines that are only links (menus, breadcrumbs, share rows), short boilerplate lines (skip link, cookie banner, newsletter prompt, footer legal, previous/next), script and style blocks, tags, images and bare URLs, and keeps every other line with its links reduced to their text. `markdownToText` (article extraction by Firecrawl) and the whole-page fallback in `fetch/firecrawl.ts` both use it.
- Why: the fallback used to turn the whole page, navigation and addresses included, into a story's summary, and `markdownToText` kept bare URLs and menus; the judge scores the first 1,200 characters and the writer reads the rest.
- Rejected: asking Firecrawl for `excludeTags` (no evidence `onlyMainContent` fails on a page we use, and a request option changes what the credits buy); a model pass to clean text (a paid call per page for a rule that fits in 60 lines).
- Revisit if: a published story's text shows menu or banner words the rules miss (add the line to the fixture), or a real body line is dropped (the rules only drop short all-link rows (a lone link only up to three words) and short boilerplate matches).

## D233: Ingest runs beside the daily fetch, free sources only, text in Blob under random keys

- Date: 2026-10-29 (Step 2 of the pipeline plan; decided for the owner, who asked for a raw news archive and a pipeline that reads before each podcast).
- Decision: `singularity ingest` (`ingest.yml`, 01:23, 09:23 and 17:23 UTC) reads the rss, github, hn, arxiv, crossref, lobsters and producthunt sources over the last 3 days, extracts each story the store does not hold (`extractFullText` with no scrape), saves its text as JSON in Blob at `ingest/<year>/<month>/<random>.json` and records it in Neon (`ingest_items`, keyed by the item id, with the Blob key; `ingest_runs`, one row a run). A story is read once; one no free route can read is tried for 3 runs. At most 600 stories a run; the 3-day window brings the rest to the next. It reads the owner's current sources from the config store and writes nothing a briefing reads.
- Why free sources only: Exa and Firecrawl spend the weekly allowance the daily needs (D222), and YouTube falls back to Firecrawl. The shadow week should show what the free sources miss before anything is paid for.
- Why random keys: Blob is public-only with readable pathnames (D173), so a key made from the story's address would let anyone check whether a story is archived and read it. The key lives in Neon.
- Shadow exit: after 7 days, the store holds 90% or more of the stories each daily aired, and 90% of the stories it tried were read. Then the daily reads the store instead of fetching (a later step). `singularity ingest --coverage` measures it from the committed dailies and Neon; a story only Exa or Firecrawl found counts as not held, which shows what the free sources miss.
- Rejected: ingest inside `run.yml` (a failure would cost a briefing); archiving the old fetch's pool (the shadow would share the path it is meant to test); keys from the URL's hash (guessable); keeping HTML (size, and nothing reads it).
- Revisit if: a week of runs leaves more than 10% of aired stories out (add a source type, paid last), or Neon's Free limits near (rows are about 300 bytes; the text is in Blob).

## D234: Vetted publishers' announcements pass the bar; a topic may carry a rubric

- Date: 2026-10-29 (Step 2 of the pipeline plan; the owner's list is his to sign off, so it ships off).
- Decision: `config/authority.json` lists domains and the categories the owner vetted each for. With `enabled: true`, an item from a listed domain whose most probable category is one of the domain's (1) is read at craft depth 0.25 at least with the hype and sponsored flags ignored (score about 0.52), (2) passes the prefilter as high signal and (3) gets one Exa query per category restricted to the listed domains (`include_domains`). Shipped off: the write stage logs the stories the list would add. A topic judged by fit may carry an optional `rubric` ("What counts: ...") in its question; only that topic is asked again. Seeded with the three labs whose own feeds fail the bar (openai.com 9 of 85 judged passed, anthropic.com 0 of 15, deepmind.google 1 of 17); the other 31 of the 34 `high_signal` sources were cut: GitHub releases and the changelog already pass (shadcn-ui 19 of 19), personal blogs and YouTube channels are voices, not first-party announcers, and a newsletter is an aggregator.
- Why: official announcements describe no technique, so the depth score (0.7 x 0.55 = 0.385) and the hype flag (openai-blog: 33 of 85 flagged) sink them under the 0.4 bar; no signal said the owner trusts the source. Exa's open queries returned small or SEO-looking domains (6 of 11), so the trusted queries name their domains.
- Rejected: a bonus added to every `high_signal` source (rewards volume, not first-party authority; 31 of the 34 already pass); authority on the whole host (a lab's customer stories and job posts are `none`, which the category check leaves alone); a tier number per domain (one lift, vetted per category, is all the owner decides); seeding rubrics (they change what airs, so they wait for the owner's wording).
- Limit: no pool survives to replay, since the run artifacts are empty, so the list could not be tested on 14 days of history. Instead the write stage logs what it would add while off, and `singularity authority replay` reads any unpacked pools. At most 47 of the 49 judged frontier items could newly pass if every one came from a vetted domain, so the 30% line is the watch.
- Revisit if: a vetted domain passes over 30% of its judged items, or an announcement outranks technique in a daily.

## D244: A YouTube video's views, against its channel's median, count as community votes

- Date: 2026-10-29 (the owner ranks YouTube, Hacker News, Reddit and blogs as the highest signal, and releases and changelogs as low).
- Decision: the YouTube fetcher reads each video's views from the feed's `media:statistics` and sets `signals.youtube_views`. When the feed holds at least 5 videos with views, it also sets `signals.youtube_votes`: `max(0, round(830 x ln(views / median) - 410))`, the median being that feed's. A typical video scores 0, 3 times the median about 500, 10 times about 1500, the range of D240's `communityStrength` (150 to 1500). `communityVotes` reads `youtube_votes` as one more platform's votes (a later change in `community.ts`).
- Why: views are not comparable across channels, so a raw count would lift every video of a big channel and none of a small one. The multiple of the channel's own median says "this one got noticed", which is what a HN score says for a link. The fetch is the only place the channel's other videos are visible.
- Found on the way: the transcript path never ran because a video is judged on its title and description, scores low on craft depth, is never selected, and transcripts are fetched only for selected stories (25 videos fetched, 13 judged, 0 passed by 29 Oct). The community lift is what lets a noticed video reach selection, where its transcript is then read.
- Rejected: raw views (above); likes from `media:starRating` (a second number that tracks views closely, and the owner asked for one signal); fetching transcripts before judging (5 Firecrawl credits a video for items most of which would still fail the bar).
- Revisit if: the feed stops giving views, or videos with votes still never pass for lack of text (then fetch the transcript before judging, for videos above 500 votes only).

## D240: What the community discusses outranks what a publisher announces

- Date: 2026-10-29 (the owner: GitHub releases and changelogs are low signal; community discussion, Hacker News, Reddit, blogs and YouTube are the highest; "cut through noise, get real data").
- Decision: (1) `config/community.json`, shipped `enabled: false`. A story's community votes are its Hacker News points plus comments, its Lobsters score times 5 and its Reddit score plus comments, summed over the platforms that carried it (dedupe keeps each platform's count). From `min_votes` (150) a built-in category is read at craft depth `max_depth` (0.25) x 0.5, rising on a log scale to `max_depth` at `full_votes` (1,500): a floor on depth, never a bonus, so an announcement reaches about 0.45 to 0.52 and technique (0.7) still outranks it. Hype, sponsored and funding flags still count. Consumer tech and a custom topic that won keep their own score. Off, the write stage logs the stories it would add. (2) Two Hacker News sources ask by topic (`hn-ai`, `hn-design`: `options.query`, any word matching, 50 and 30 points) instead of Show HN alone. (3) A `reddit` source type (`options.subreddit`: top posts for the fetch window at or above a score floor) with six subreddits, shipped off. (4) The eight GitHub release sources and the shadcn changelog lose `high_signal`.
- Why: the score ignored engagement (HN points only ranked the prefilter's pool), so an announcement nobody reacted to and one a thousand people argued over scored alike. D234 lifts by publisher status, the opposite of what the owner reads for; votes show that practitioners wanted the story.
- Rejected: a bonus on top of the score (a hot thread would outrank technique); lifting on votes alone (HN and Reddit reward drama as readily as substance, so the flags and the depth check stay); reading Reddit through Firecrawl (spends the weekly allowance, D222).
- Limit: Reddit refused the cloud container (403 for JSON, 429 for RSS) and no runner has tried, so the six subreddits ship off. YouTube counts join as votes through D244, normalised per channel. The thresholds are guesses to tune from the shadow log. No pools survive to replay.
- Revisit if: a Reddit source gets through from a runner (switch it on, or add OAuth credentials if it does not), a source passes over 30% of its judged items, or a heavily voted but shallow story airs above a technique piece.
- Amends: D234 (the authority list stays, off, as the second signal).

## D248: A favorite creator's videos are trusted: read at a minimum depth, sponsor reads cut by the writer

- Date: 2026-10-30 (the owner: a video should not be judged on title, views or likes; the creator already filters; strip sponsored parts of the transcript).
- Decision: a video from a YouTube channel marked Favorite carries `signals.creator_vetted`. `withCreator` (score/creator.ts) reads it at craft depth 0.25 at least with the hype and sponsored flags ignored, the same lift as D234, applied to every video whose category the judge placed (not `none`). The writer's source block tells it a video text is a transcript and to leave out sponsor reads, ads, discount codes, affiliate links, product plugs and calls to subscribe. The transcript still comes only for a selected story (cache, Firecrawl, Gemini; D244 found 13 judged and none selected).
- Why: Jev sees a title and 1,200 characters of description, which say little about a video; views and likes track channel size (D244 scales them per channel, but a score from them is still not the content). A creator who covers a subject has picked it. Sponsor reads sit in the transcript, so the writer is where they come out.
- Rejected: fetching every transcript before judging (credits and time for videos the creator-trust makes unnecessary to judge); a regex strip of sponsor segments (they are phrased freely); a lift on every YouTube video (the owner's Favorite switch is the filter).
- Limit: YouTube refuses its caption API to GitHub's runners (yt-dlp too, 2026-10-24), so a selected video's transcript costs Firecrawl credits (about 5) or a Gemini transcription. Selection caps keep that to a few videos a run.
- Revisit if: favorited videos air without a transcript (extract falls back to the description), or a sponsor read reaches a summary.

## D250: The vetted-publishers file is named for what it is; Reddit leaves the registry

- Date: 2026-10-30 (the owner: "Authority" is a poor name, rename everything; Reddit blocks bot scraping, so drop it or archive it).
- Decision: (1) `config/authority.json` is `config/trusted-publishers.json`, with the same shape and `enabled: false`. The module is `trustedPublishers/`, the command `singularity publishers replay` (was `authority replay`), the score breakdown flag `trusted_publisher` (was `authority`, stored in no file). (2) The six Reddit seeds are out of the seed list and `config/sources.json`. The `reddit` source type, its vote fields and the prefilter term stay as dormant code. Sources stay grouped by topic category; the list is keyed by domain and is not a second grouping of sources.
- Why: the old name said nothing about what the file holds, and Reddit refuses datacenter addresses, so the six subreddits only ever failed or sat off.
- Rejected: moving the Reddit rows to a disabled archive file (a second source list for rows that cannot run); renaming only the file (the code and the command would keep the word the owner dislikes).
- Limit: the runtime source list lives in the config store (D149), where the six disabled rows may remain; they fetch nothing. D240's decision text still lists the six subreddits as shipped off; this entry replaces that part.
- Revisit if: the owner wants Reddit back (add OAuth credentials and new `reddit` entries).
- Amends: D234 (file, module and command names), D240 (Reddit sources removed).

## D251: Ingest saves a run's stories as one Blob object; an unchanged content sync writes nothing

- Date: 2026-10-30 (the Blob store was blocked at 100% of Hobby's 2,000 advanced operations; the site answered 503 until it lifts).
- Decision: `runIngest` extracts every story first, then saves them in one pack, `ingest/<year>/<month>/<random>.json` (`{ version: 2, items: [{ item_id, url, title, source_id, published_at, fetched_at, method, truncated, text }] }`), one `put` a run. Every row of the run keeps that key in `archive_key`; the story is the pack item with its `item_id`. A refused write archives nothing: the run counts every extracted story as an error and the next run reads them again. `syncContent` leaves the manifest alone when it uploaded and deleted nothing.
- Why: a `put` is one advanced operation, and the old ingest spent one per story, up to 600 a run, three runs a day. Three runs used most of the month's 2,000. A pack makes it three a day.
- Rejected: moving the texts to Neon (500 MB Free, and a few MB a day of article text would fill it in months); fewer ingest runs (the cost was per story, not per run); a Pro plan (the project stays on free plans).
- Limit: the remaining writers are covers (about nine puts for each new briefing or episode, `storeCovers.ts`), live scripts (two copies a write), stage artifacts (one per stage) and content sync (one per changed file). They stay inside the allowance at one briefing and a few episodes a day; a fourth episode a day would need covers packed or drawn on request.
- Revisit if: Blob operations in the Vercel dashboard pass 1,000 a month, or something reads one story's text (then split the pack by source or hour so a read fetches less).
- Amends: D233 (the key names a pack, not a story).
