# Reliability audit, 2026-10-15

Started from the owner's report: on a podcast page, "Stop hearing from reveneau.com" answered "Could not stop reveneau.com yet. Try again." This file is the evidence; [state.md](../state.md) carries the outcome.

## 1. Executive result

- **Fixed and verified:** the known bug (a stop inside the server's ten seconds after another edit was refused and never retried), four related defects in the same sender, a Blocked outlets page that hid a domain blocked again after its unblock, and a reversed `Range` header answered 416.
- **Passed after the change:** the gate (typecheck, lint, 4,716 unit tests in 251 files, `astro check`, static build), the production build with the Vercel adapter (bundle budget met, 106.1 of 109.0 KB), the site browser suite (356 passed; the 2 failures were stale specs, red on `main` too, now fixed and passing), the player suite (70 of 70).
- **Pre-existing failures found and fixed:** two browser specs pinned the old copy "Today" after #138 renamed it "Latest"; red on `main` before this branch.
- **Unresolved, documented in section 8:** config edits GitHub can cancel after the server said 202 (high), races past every server limit, episode deletes counting against Create's limits, Generate and Podcast answering 503 after a run started, anonymous Blob reads on `/api/stream`, and the production cause of the owner's own failure (production is not reachable from this environment).

## 2. Known bug analysis

**Path.** `StoryControls.astro` (More menu, `data-block`) → `storyVotesEntry.ts` → `storyVotes.ts` `block()` → after the 5 s Undo, `sendBlock()` → `POST /api/config {op: profile.block}` → `server/configEdit.ts` `handleConfig` → GitHub `config.yml` dispatch → `dispatch config apply` → `config/profiles/owner.json`.

**Reproduction** (dev server with the real handler and a GitHub fake that lists each dispatch as a run, `/d/2026-10-13`, the reveneau.com story):

- One stop alone: `202`, works.
- Stop zandigital.in, then reveneau.com two seconds later: the second request answered `429 {"error":"cooldown","retry_after_s":8}` and the page said **"Could not stop reveneau.com yet. Try again."** Exact match.
- Like a story, stop reveneau.com, switch tabs inside the Undo: the vote batch got `202`, the block `429`, and the block was lost with no message (the page was hidden).

**Root cause.** The server takes one config edit every ten seconds, counted from the newest `config.yml` run, and answers 429 with `retry_after_s` inside that gap (`configEdit.ts`, `CONFIG_COOLDOWN_MS`). The settings pages know this (`managePageSave.ts` holds each request out of the gap, waits out a 429, and batches). The story controls did not: `storyVotes.ts` sent votes and each block as separate requests, often at the same moment (`leave()` sent both), and treated any answer but 202 as final. "Try again" could succeed only if the reader waited ten seconds first. Any edit in the previous ten seconds (another stop, a vote batch, a settings save) was enough.

**Fix** (`apps/web/src/scripts/storyVotes.ts`, `apps/web/src/lib/storyVotes.ts`):

- One sender for votes and blocks. Everything waiting goes in one request (`nextRequest`: blocks first, then the vote ops that fit 8 ops and the body limit).
- The next request is held until 10.25 s after the last one went through (`gapLeft`); a 429 waits as long as it asks, up to six times, as the settings do.
- A stopped outlet is kept on the device (`dispatch:story-blocks`) until the server takes it, so a page closed or reloaded inside the gap sends it on the next visit.
- A block the server took is written to the saved-edits overlay, so Settings, Blocked outlets lists it before the next build lands.
- A genuine failure (503, 400, network) still says "Could not stop X yet. Try again.", once, and leaves nothing queued, so pressing again is a real retry.
- Undo after the five seconds still takes the outlet back while it waits for the gap; once its request is on its way it goes, as before.
- A request with votes refused as invalid (400) is retried with the blocks alone, so a bad vote cannot hold a stop back.

**Production cause: not confirmed.** The `config.yml` run list on GitHub shows no run at all after 2026-10-14 13:08 UTC, and no profile edit has ever reached the repository (`config/profiles/owner.json` does not exist). The same message appears for any non-202, so two causes fit: the 429 above (code, reproduced), or a 503 from a refused GitHub dispatch (environment: an expired or narrowed `GITHUB_DISPATCH_TOKEN`). The site was not reachable from this environment to tell them apart. **Check:** Vercel function logs for `[api/config] config failed: GitHub answered 401` (or 403). If they are there, the token needs renewing and this fix alone will not make the stop work in production.

## 3. Testing gap

**What covered it.** `e2e/storyVotes.spec.ts` (one stop with Undo), `server/configEdit.test.ts` (parsing the op), `lib/storyVotes.test.ts` (pure vote state), engine `config-apply.test.ts`.

**Why they passed.**

- **Excessive mocking with a lenient fake.** The spec routed `/api/config` to a stub that answered 202 to every request. The server's one stateful rule, the ten-second gap, did not exist in the test world, so the failure mode could not happen.
- **One action per test.** Each journey made one request. The bug needs two edits inside ten seconds.
- **Assertions on the request, not the outcome.** The spec checked that a `profile.block` was sent, not that it reached the workflow or that the page said the truth afterwards.
- **No browser test ever reaches a real API handler.** The e2e build prerenders every API route as a static stub (`stubApiRoutesForStaticBuild`, "their logic is covered by unit tests"), and the handler's unit tests call it once per case, never in sequence with a client.
- **The sender itself had no tests:** only its pure helpers did.

**What changed.**

- `e2e/configServer.ts` answers `/api/config` with the site's own `handleConfig`, faking only GitHub (each dispatch is recorded as the edit the workflow would apply and listed as a run) on the page's clock, one request at a time. The cooldown, validation and body limit now hold in the browser tests.
- `storyVotes.spec.ts` asserts what reached the workflow (`server.applied`) and every status, and adds the two journeys that failed:
  - two outlets stopped in a row;
  - a vote and a stop as the page is left.
  Both were red on `main` in two runs and green in three runs with the fix.
- `lib/storyVotes.test.ts` replaced "splits votes into ops of fifteen" (a constant pin) with a test that runs every packed request through the server's own `parseConfigRequest`. It was red without the size cap (a batch of long headlines was refused as invalid every time).

**Recommended next.** Point the other `/api/config` specs (`topics`, `podcast`, `heldSave`, `heldAway`) at `routeConfigServer`, and give `/api/podcast` and `/api/generate` the same treatment. Each of those specs fakes a 202 by default today.

## 4. Defect register

| # | Severity | Defect | Reproduction | Root cause | Fix | Verification |
|---|---|---|---|---|---|---|
| 1 | High | Stop hearing from an outlet fails with "Could not stop X yet" | Stop one outlet, then another within 10 s; or stop one within 10 s of any config edit | The story sender took a 429 as final, and sent concurrent requests | One queue, gap hold, 429 wait, one request | Spec red on main, green; dev-server run: two stops both 202 |
| 2 | High | A stop left on page hide is lost silently | Stop, switch tabs inside Undo while a vote batch goes | Block and votes sent at once; the block got 429 with no one to see it | Single combined request; outbox kept until a 202 | Spec "a vote and a stop ... page is left"; dev-server run, one request with both ops |
| 3 | Medium | A vote batch with long headlines and addresses is refused forever and holds every later vote | 15 votes with ~300-character URLs and 200-character headlines: body over 8,192 characters, 400 every 10 minutes | Ops chunked by count only | `pendingOps` caps each op by size | Unit test through `parseConfigRequest`, red without the cap |
| 4 | Medium | More than 15 unsent votes: the second op always gets 429 | 16 votes then hide the page | Ops sent back to back | Packed into one request, the rest after the gap | Covered by the sender rewrite; reviewed |
| 5 | Medium | A stop accepted by the server does not show on Settings, Blocked outlets until the next build | Stop from a story, open Blocked outlets | Only the settings sender wrote the saved overlay | Accepted blocks are written to `dispatch:saved-edits` | Spec checks both domains listed; dev-server run lists them |
| 6 | Medium | Blocked outlets: a domain blocked again after its unblock was saved stays hidden and the count reads "None" | Unblock, wait for the save, block the same domain | `settle` leaves `data-removing` on the row; `add` cleared only `data-gone` | Clear both (`blockedPage.ts`) | `topics.spec.ts` Blocked outlets extended: red on main at the new line, green |
| 7 | Low | Storage that reads but refuses writes (quota full) loses every vote and stop | Fill storage, vote | Each load re-read storage and overwrote memory | Memory is trusted once a write fails | Reviewed (no browser test: storage quota is not reproducible in the suite) |
| 8 | Low | A reversed `Range` (`bytes=5-2`) on `/api/voice-sample` answers 416 | `byteRange("bytes=5-2", 100)` | Treated as unsatisfiable; RFC 9110 says ignore it | Return null (whole file) | Unit assertion added |
| 9 | Low (tests) | Two browser specs failed on `main` | `reader.spec.ts:860`, `routes.spec.ts:18` | #138 renamed Today to Latest; the specs pinned the copy | Assert the link target instead of the word; drop the body-copy pin (AGENTS.md: never pin copy) | Red on main, green |

## 5. Workflow audit matrix

Status: **verified** (exercised in the running app or a browser journey on this branch), **failed→fixed**, **unit only** (logic tested, not run end to end here), **untested**, **blocked**.

| Workflow | Routes and API | Scenarios exercised | Status |
|---|---|---|---|
| Stop hearing from an outlet | `/`, `/d/[id]`, `/e/[id]` → `/api/config` | One stop; Undo; two in a row; with a vote on hide; reload inside the gap; genuine 503; Settings reflects it | failed→fixed, verified |
| Like / dislike | same | Vote, reload keeps the mark, sent once on leave; batch with a stop | verified |
| Blocked outlets page | `/settings/blocked-outlets` → `/api/config` | Invalid input, add, reload, Undo, unblock, re-block | failed→fixed, verified |
| Topics and sources edits | `/settings/topics`, `/settings/topics/[id]` → `/api/config`, `/api/source-preview`, `/api/site-icon` | Browser suite (202 and 500 faked) | verified (fake API) |
| Schedule, Model | `/settings/daily`, `/settings/weekly`, `/settings/model` → `/api/config`, `/api/models`, `/api/voices` | Browser suite (202, 503, abort faked) | verified (fake API) |
| Create an episode, Try again | `/create`, sheet → `/api/podcast`, `/api/status`, `/api/stream` | Browser suite (202, 400, 401, 429, 503, abort) | verified (fake API) |
| Regenerate / delete an episode | `/e/[id]` → `/api/podcast` | Browser suite (202, 429) | verified (fake API) |
| Generate / regenerate a briefing | sheet → `/api/generate`, `/api/status` | Player suite (202, one 503) | verified (fake API); 400, 401, 429 untested |
| Delete a briefing | `/d/[id]` → `/api/generate {action: delete}` | None: no spec sends it | untested (unit only) |
| Play a briefing or episode | all reading pages → `/api/narrate`, `/api/narrate-marks`, Blob | Player suite, 70 journeys | verified (fake API) |
| Narrate on demand | Play chip → `/api/narrate` POST | Player suite (200, 429, 500, 503) | verified (fake API) |
| Library search | `/library`, `/search-index.json` | Browser suite | verified |
| Offline, service worker | `/sw.js`, `/offline` | Browser suite | verified |
| Scheduled briefing | `/api/cron/run` → `run.yml` | Unit tests only | unit only |
| Voice sample | `/api/voice-sample` | Unit tests; reversed range fixed | unit only |
| Live episode copy | `/api/stream` | Unit tests | unit only |
| Real GitHub, Speechify, Blob, Vercel | production | Not reachable from this environment | blocked |
| The engine's apply of `profile.block` | `config.yml` → `config apply` | Engine unit tests | unit only; no profile op has ever run live |

Routes inventoried: `/`, `/d/[id]`, `/e/[id]`, `/library`, `/create`, `/settings`, `/settings/daily`, `/settings/weekly`, `/settings/model`, `/settings/topics`, `/settings/topics/[id]`, `/settings/blocked-outlets`, `/offline`, `/404`, the JSON and image routes, the 308 redirects in `astro.config.mjs`, and 13 API routes (`config`, `generate`, `podcast`, `status`, `stream`, `narrate`, `narrate-marks`, `voices`, `voice-sample`, `models`, `source-preview`, `site-icon`, `cron/run`).

## 6. Verification results

Environment: Linux container, Node 24.22, Chromium headless 1194 standing in for Playwright's 1248.

**Baseline on `main`:**

- `npm run gate -- --build`: all five pass.
- The two copy specs fail on `main` (`reader.spec.ts:860`, `routes.spec.ts:18`).

**On the branch:**

- `npm run gate -- --build`: typecheck 16 s, lint 4 s, unit 75 s, site types 27 s, build 6 s, all pass.
- `npx vitest run`: 251 files, 4,716 tests pass.
- `npm run build` (Vercel adapter): passes. "Largest first load: 106.1 KB of 109.0 KB. Bundle budget met."
- `npm run e2e -w @dispatch/web`: 356 passed, 2 failed (the two pre-existing copy specs). After fixing them, those two plus `storyVotes` and `topics` give 41 of 41.
- `npm run e2e:player -w @dispatch/web`: 70 passed.
- `storyVotes.spec.ts` against `main`'s sender: 2 failed (the new journeys, 429 in the console), twice. With the fix: 4 passed, three times.
- `lib/storyVotes.test.ts` without the size cap: "expected null not to be null". With it: pass.

**In the running app** (`astro dev` with the real handler and a GitHub fake):

- Two stops: `202`, then `202` 10.3 s later.
- Vote and stop on hide: one request carrying both ops.
- Reload inside the gap: the outbox survives the reload, the next page sends it, gets `429`, waits and gets `202`. Blocked outlets lists both domains.
- GitHub refusing (401): `503` and the toast "Could not stop reveneau.com yet. Try again."

## 7. Change summary

- `apps/web/src/scripts/storyVotes.ts`: the sender rewritten as one queue (gap, 429 wait, combined request, durable outbox, saved overlay, honest failure, Undo until sent).
- `apps/web/src/lib/storyVotes.ts`: `pendingOps` capped by size; `nextRequest`, `gapLeft`, `parseBlocks` and the client copies of the server's limits (the repository's convention, as `managePageSave.ts` does).
- `apps/web/src/scripts/blockedPage.ts`: one attribute cleared on re-block.
- `apps/web/src/server/voices.ts`: reversed range ignored.
- Tests:
  - `e2e/configServer.ts` (new);
  - `e2e/storyVotes.spec.ts`: on the real handler, plus two journeys;
  - `e2e/topics.spec.ts`: re-block step;
  - `lib/storyVotes.test.ts`: one constant pin replaced by a server-parser check;
  - `server/voices.test.ts`: one assertion;
  - `reader.spec.ts`, `routes.spec.ts`: copy pins removed.

**Architecture.** Votes now ride along with any stop (one run instead of two). A stop can wait up to about 10 s for the gap before it is sent, which the reader does not see: the Undo toast stays until the server takes it. No server, workflow or dependency change. No file overlaps PRs #63, #64 or #65.

## 8. Remaining risks and follow-up

1. **High: a 202 for an edit GitHub may cancel.**
   - `config.yml` shares the concurrency group `dispatch` with `run.yml`. GitHub keeps one running and one pending run per group and cancels the older pending one.
   - Evidence: runs 16 and 19 on 2026-10-13 were cancelled with zero jobs, so their edits never applied, after the server had answered 202.
   - It also means a config edit can displace a queued briefing, and the reverse.
   - Fix: give `config.yml` its own group and make `config commit` re-apply the op after a rebase conflict (a workflow change, merged by hand).
2. **Medium: concurrent requests pass every server limit.** Each handler lists runs, then dispatches, with nothing between.
   - Five concurrent `/api/generate` calls gave five dispatches against a cap of 3 a day.
   - Fix: a lock in Blob or KV keyed by workflow.
3. **Medium: Generate and Podcast answer 503 after the run started** when GitHub omits the run id and the run is not listed yet.
   - A retry can duplicate an episode.
   - Not fixed: the clients treat a 202 without `run_id` as "did not start" (`create.spec.ts` pins that), so the fix needs a decision on what a run that cannot be followed shows.
4. **Medium: episode deletes count against Create's cooldown and daily cap, and the reverse** (`podcast.ts`). Fix: a `run-name` on `podcast.yml` (merged by hand), then filter as `generate.ts` does.
5. **Medium: anonymous Blob reads.**
   - `/api/stream` and `GET /api/narrate` for unknown episodes read the metered store on every call, with a cache-busting `?t=`.
   - About 10k calls would use the Hobby plan's monthly allowance and lock the store for 30 days (learnings, 2026-10).
   - Fix: a per-IP limit, or read only run ids GitHub lists as recent.
6. **Low: a vote sent as the page closes and refused (429 from a settings save in the previous ten seconds) is lost.** Votes are marked sent before the answer, by design, because a leaving page never hears it.
7. **Low: a stop sent as the tab closes is sent again on the next visit.** The outbox clears only on a 202 the page heard. The edit is idempotent; the cost is one extra workflow run. Two open tabs can also both send a waiting stop.
8. **Untested here:** Safari, a real phone, any live GitHub, Speechify or Vercel call, the engine applying a profile op in `config.yml` (it has never run in production), and the production cause of the owner's report (section 2).
