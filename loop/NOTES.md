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
