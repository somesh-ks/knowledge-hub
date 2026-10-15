# Loop notes: episode quality (track A) and the stop error (track B)

Branch `claude/episode-quality-stop-error-6erq7k`, from `main` at 68aa9d1 (PR #140 merged).

## Defaults for the brief's placeholders

| Placeholder | Value |
|---|---|
| Length tolerance | ±10% of the setting |
| N substantive segments per selected topic | 1 |
| X, most airtime on unselected topics | 20% |
| Major airtime | at least 80%, and zero changelog segments |
| Quality | mean at least 4, nothing below 3, two judge runs must agree |
| Iteration cap | 8 |

## Track B: "Could not stop reveneau.com yet. Try again."

### What "stop" means here

"Stop hearing from <outlet>" in a story's More menu. It is not stopping a job: it adds the outlet's
domain to the owner's blocked list so later briefings and episodes leave it out. Path:
`StoryControls.astro` → `scripts/storyVotesEntry.ts` (lazy import) → `scripts/storyVotes.ts`
`block()` → 5 s Undo → `send()` → `POST /api/config {op: profile.block, domain}` →
`server/configEdit.ts` `handleConfig` → GitHub `workflow_dispatch` of `config.yml` →
`dispatch config apply` → `config/profiles/owner.json`. Nothing on this path contacts the outlet:
the domain is a string the server checks for shape (`lib/blockedOutlets.ts` `blockedDomainOf`).

### Where the message comes from

One line, `scripts/storyVotes.ts:255` on main: any answer that is not 202 (after up to six 429
waits) toasts `Could not stop ${outlet} yet. Try again.` The real cause (the status and the
server's `error` code) was dropped: `post()` returned only `{status, wait}`, nothing was logged in
the browser, and the server logged nothing when its settings were missing (`handleConfig` returned
503 silently; GitHub failures were logged as `[api/config] config failed: GitHubError: GitHub
answered <n>`).

Causes that reach that line on main (all confirmed by the new test, `scripts/storyVotes.test.ts`):

| Answer | Cause | Retry helps? | Shown on main |
|---|---|---|---|
| 429 ×7 | Ten seconds between edits, refused seven times in a row | later | "Could not stop X yet. Try again." |
| 503 | Site cannot reach GitHub: token refused/expired (401/403), repo not found (404), outage, or settings missing on the deployment | no for a token, later for an outage | same |
| 400 | Domain not a dotted host (`localhost`, an IP-less host) or a malformed body | no | same |
| 401 | Passphrase wrong or missing (passphrase is off since D41, so not reachable today) | no | same |
| 0 | No answer (offline, request blocked) | yes | same |

### Reproduction

Production (`news.someshks.work`) is not reachable from this container (proxy refuses the host),
so the reproduction runs the real sender and the real `/api/config` handler in Node with only
GitHub faked (`apps/web/src/scripts/storyVotes.test.ts`):

- Inputs: stop `https://reveneau.com/ainews/a` (outlet reveneau.com), then
  `https://zandigital.in/b` (zandigital.in), with GitHub answering 401 to the site's token.
- Output on main: both 503, both toast **"Could not stop reveneau.com yet. Try again."** /
  **"Could not stop zandigital.in yet. Try again."**, nothing logged. Exact match of the report.
- The same two domains with GitHub working: both 202, both applied, no message (PR #140's fix holds).
- `localhost` (not a dotted host): 400, same message. Offline: status 0, same message.

### Classification: architectural (shared path), not domain-specific; no blocklist

- reveneau.com and zandigital.in behave identically in every case: the server never resolves or
  contacts the domain, and `reveneau.com` passes `blockedDomainOf` (valid dotted host). No property
  of the domain can trigger the failure. A blocklist would change nothing.
- The failure lives in the shared path: (1) the server's ten-second gap, fixed by #140; (2) every
  other failure collapsed into one message that blames timing ("yet. Try again.") and drops the
  cause. Retrying cannot help a refused token or a refused address.
- Production evidence (GitHub API, 2026-10-15 13:20 UTC): the last `config.yml` run is #28,
  2026-10-14 13:08 UTC. No `workflow_dispatch` run of any workflow the site starts (config, podcast,
  generate) exists after that. Under #140's sender a 429 is waited out and then dispatched, so a
  stop that still fails after #140 deployed and leaves no run must have been answered 400, 401, 503
  or nothing. 503 from GitHub refusing the token is the only one that fits every domain and every
  retry. **Inference, not confirmed:** the Vercel log line `[api/config] config failed: GitHubError:
  GitHub answered 401` (or 403), or the new `config unavailable: ... is not set`, decides it.
  Whether the owner pressed Stop after #140 deployed (12:07 UTC) is also unknown here.

### Fix (this branch)

- `lib/storyVotes.ts` `stopFailure(outlet, status)`: one message per cause, naming what failed and
  whether pressing again helps (`now` / `later` / `no`).
- `scripts/storyVotes.ts`: `post()` keeps the server's `error` code (or the network error); a failed
  stop logs `[story controls] stop <domain> failed: <status> <cause>` and shows `stopFailure`'s
  message. No retry loop added: 400/401/503 are not retried; 429 keeps #140's bounded wait.
- `server/configEdit.ts`: logs `config unavailable: ... is not set` when the deployment lacks its
  settings, the one 503 that logged nothing.
- Not changed, needs your call: the 503 body is the same for a refused token and a GitHub outage
  (`{error: "unavailable"}`, pinned by two existing tests, `configEdit.test.ts:508` and `:800`). A
  `reason` field would let the page say "won't help until the token is fixed" instead of "if it
  keeps failing"; it means editing those two assertions.

### Test audit: why nothing caught it

| Test | Mocks | Asserts | In CI? |
|---|---|---|---|
| `apps/web/e2e/storyVotes.spec.ts` (4 journeys) | GitHub, via `e2e/configServer.ts` (real handler since #140; a 202-to-everything stub before) | ops that reached the workflow, statuses, absence of "Could not stop" | **No**: browser suites are not in `ci.yml` (`npm test` = vitest only) |
| `apps/web/src/server/configEdit.test.ts` | `fetch` to GitHub | parsing, 400/401/429/503/202 per single request; 503 body pinned as generic | yes |
| `apps/web/src/lib/storyVotes.test.ts` | none (pure) | vote state, packing through `parseConfigRequest` | yes |
| `packages/engine` `config-apply` tests | file system | applying `profile.block` | yes |

Why it was missed: before #140, a lenient fake (always 202) and one request per test hid the
429. #140 fixed that cause and added the right journeys, but (a) only in the browser suite, which
CI never runs, so the sender has no test in CI; (b) only the happy path after a 429: no test sends a
stop that fails for any other reason, so the message was never asserted for a known cause; (c) the
handler's 503 is pinned as deliberately generic, so the cause could not reach the page.

### Tests added (`apps/web/src/scripts/storyVotes.test.ts`, runs in `npm test`)

Real sender + real handler, fake GitHub, fake clock, no sleeps:

1. two outlets stopped inside the ten seconds are both applied (the #140 bug, now in CI);
2. a stop pressed while another request is in flight is sent after it;
3. an outlet pressed twice is sent once;
4. refused token (503) for reveneau.com and zandigital.in, invalid domain (400), offline (0): each
   shows its own cause's message, logs the real status, retries nothing, keeps nothing queued;
5. `stopFailure`: retry advice per status, messages distinct;
6. `handleConfig` without settings logs why it answers 503.

"Unreachable domain" is not a failure mode on this path (the outlet is never contacted); test 4
uses a domain that is valid but irrelevant to reachability.

Proof (vitest, 2026-10-15):

- Fix reverted (main's `storyVotes.ts` and `configEdit.ts`): tests 4 and 6 fail. Received
  `["Could not stop reveneau.com yet. Try again.", "Could not stop zandigital.in yet. Try again.",
  "Could not stop localhost yet. Try again.", "Could not stop reveneau.com yet. Try again."]`.
- Pre-#140 sender and lib (68aa9d1^): tests 1, 2, 4, 6 fail.
- Fix restored: 6 of 6 pass.

### Same pattern elsewhere (not fixed here)

- `scripts/storyVotesEntry.ts:43`: if the sender chunk fails to load (offline, stale deploy), the
  press does nothing and the rejection is unhandled: no message, no log.
- `CreateForm.astro:76`, `EpisodeActions.astro:42`, `RunStatus.astro:35`: every 503 says "not
  available right now. Try again in a few minutes", including a refused token, where retrying
  cannot help. Same conflation as the stop, server side in `generate.ts`/`podcast.ts`.
- `server/generate.ts`, `server/podcast.ts`: `readServerConfig` null returns 503 with no log (same
  silent branch fixed here for `/api/config`).
- Open from the audit: `config.yml` shares the `dispatch` concurrency group with `run.yml`, so a
  pending stop can be cancelled after a 202 (a stop that "worked" but never applies).

## Track A: episode quality

### What the daily and weekly episodes are

They are the narrated briefings, not Singularity podcast episodes. `run.yml` (hourly cron) gates,
fetches, judges, writes and commits `Digests/YYYY/MM/<date>[-weekly].md`, then `audio.yml` runs
`dispatch publish`, which reads each item's `spoken` text through `buildSpokenText`
(`engine/src/audio/spokenText.ts`) and sends it to Speechify. Settings: `config/schedule.json`
(daily 5 min, skip business/sports/culture; weekly 15 min, skip business/sports). On-demand podcast
episodes (`podcast.yml`, `Podcasts/`) are a separate path (`engine/src/podcast/`).

App speech rate: 968 characters a minute (`PODCAST_CHARS_PER_MINUTE`, core/src/podcast.ts:11), about
161 words a minute. Confirmed against the audio: 2026-10-13 is 3,501 characters in 3.83 min (914/min,
the frame's pauses included); the eval's script estimate (3.6 min) and the audio (3.8 min) agree.

### Pipeline, settings to audio

1. Settings: `writeStage.ts:120-133` reads `skip_topics` and `length_minutes` (daily) and the weekly pair.
2. Fetch: `run/gatherPool.ts` (weekly reads weekly-tier sources too).
3. Prefilter: `prefilter/prefilter.ts:204-236` (keywords, author, `high_signal` +3, `releaseWeight`).
4. Judge: `judge/questions.ts` (category probabilities, craft depth, launch scale, flags).
5. Score: `score/scoreItem.ts:142-156`, taste × depth × penalty + bonus; bar 0.4.
6. Select: `score/selectItems.ts:309-396`, cap from `run/scheduleSize.ts` `capForLength`.
7. Write: one `spoken` block per item, 40 to 95 words (`write/prompt.ts:34`).
8. Narrate: `buildSpokenText` (frame + items), no length target; Speechify.

### Causes

| # | Problem | Cause | Status |
|---|---|---|---|
| L1 | A1 length | `capForLength` sizes by story count, assuming the full cap of 12 is 10 minutes (`scheduleSize.ts:7-10`). A real item is about 25 s (2026-10-13: 9 items, 3.8 min), so 12 items is about 5 minutes and the 5-minute daily gets 6 main items | confirmed (code + audio) |
| L2 | A1 length | Weekly 15 min asks for 27, clipped to the weekly cap of 18 (`digest.ts:103`); 18 items is about 7.5 min, so 15 is unreachable by design | confirmed (code) |
| L3 | A1 length | Nothing measures or targets minutes after selection: per-item text is 40 to 95 words whatever the setting; drops after selection (extract, write, voice) shrink it further | confirmed (code) |
| L4 | A1 length | Supply is not the limit: the 2026-10-13 run judged 59 items, 26 cleared the 0.4 bar (no keyword bonus counted), 9 were published. Weekly 2026-10-11: 86 judged, 38 cleared, 10 published | confirmed (fixture replay of `scoreItem`) |
| I1 | A2 changelogs | Release sources get a prefilter bonus (`high_signal` +3, `releaseWeight` up to +2.5) and no later penalty; a minor release judged `developer_tool_launches` with craft depth 0 still scores 0.45, above the 0.4 bar (`scoreItem.ts:46`) | confirmed (code) |
| I2 | A2 changelogs | "Tech releases" and custom sections get allowances on top of the cap (`selectItems.ts:94-106,334-335`); the weekly forces one below-median-weight item, which today is a launch category (`selectItems.ts:354-370`) | confirmed (code) |
| I3 | A2 changelogs | Of the 26 eligible items on 2026-10-13, 16 are `consumer_tech_releases` or `developer_tool_launches`: filling to length from this pool draws more launches. Length and importance pull against each other on a normal day | confirmed (fixture replay) |
| T1 | A3 topics | Topics are a skip list; no selected topic is guaranteed a story; items are taken by rank, at most 3 per home section, and five categories share the one `ui-craft` section (`selectItems.ts:343-350`, `categories.ts:97-109`) | confirmed (code) |
| T2 | A3 topics | `trending` is `enabled: false` in config/topics.json, yet 2026-10-11 aired 3 `trending` items. config/topics.json first appears in history on 2026-10-14, after that briefing, so it may have been on then | hypothesis |
| T3 | A3 topics | General topics `science`, `culture` never appear in the month's briefings | hypothesis: no general candidates clear selection |

### Fixtures (`loop/fixtures/`, frozen 2026-10-15)

- `daily-2026-10-13/`, `weekly-2026-10-11/`: the run's judged pool (`pool.json`, from
  `state/judgments.json` and `state/topic-judgments.json` by judge hour), the settings production used
  (`settings.json`), a variant with a different length and topics (`settings-variant.json`), and
  the episode production made (`episode.md`, `episode.audio.json`).
- `topics.json`, `preferences.json`: copies of config at the snapshot.
- Gap: the engine does not keep a run's fetched items, only its judgments and the published items,
  so an unpublished item has no headline, text or URL. A run cannot be replayed end to end from the
  repository; generating a new episode from a fixture needs the fetch step's output or a live fetch.

### Eval

`loop/eval.ts` with `loop/rubric.md` (topic and importance definitions fixed there). Length and
topics are deterministic; importance and quality need `ANTHROPIC_API_KEY` and report BLOCKED
without it. Baseline: `loop/results/iteration-0.md`, 2 of 14 rows pass (both "unselected airtime"). The month's table there uses today's settings; the length setting before 2026-10-13 is not in history.

### Blocker

No model key in this environment (`NEBIUS_API_KEY`/`DISPATCH_MODEL` for the writer,
`ANTHROPIC_API_KEY` for the judge). Without the writer no fixture can be turned into a new episode,
so no iteration can be scored: the loop has not started. Asked the owner (2026-10-15).

### Judges (owner's direction, 2026-10-15)

Importance: Jev labels each segment (`TYPESAFE_API_KEY`). Quality: the newest Sonnet on the
Anthropic model list scores the episode, effort left to the model (`ANTHROPIC_API_KEY`). Both keys
exist only as repository secrets, so `.github/workflows/episode-eval.yml` runs the eval on this PR
and writes the table to the job summary. Changed before any track A fix; the rubric's definitions
did not change.

### Iterations (results in `loop/results/`)

1. Every topic's best story first (T1): applied.
2. Size by airtime, all sections inside the length (L1, and I2's allowances on top of the cap): applied.
   `capForLength` is gone; `storiesForMinutes` uses 364 spoken characters per story.
3. Weekly held to its length instead of 18 (L2): reverted first, because the validator capped main
   stories at 12 and 18. Applied as iteration 4 at the owner's word ("the length should follow
   the settings"): a length-sized briefing is held to its length; the kind caps apply only to
   unsized and agent-written digests.

5. Release notes and the writer (I1, quality), at the owner's word: patch releases never air,
   release notes take at most a tenth of the main stories; the writer's brief drops the fixed
   "The catch:" ending and repetition. `loop/rewrite.ts` judges the writer before and after.

6. Repetition at its source, at the owner's word ("go crazy", "iterate until finished"): one
   telling per story (`score/sameStory.ts`), a spoken telling with a stray number is rewritten
   before it is dropped, the fallback skips a headline the summary restates, and the writer never
   reviews the article or puts a catch on hard news. See `results/iteration-6.md`.

Still failing before iteration 5 (`results/judged-replays.md`): importance (package releases clear the 0.4 bar, I1, a
scoring policy), quality (the writer stage; the replay does not run it), and the quality judge
disagrees with itself on about half the episodes.
