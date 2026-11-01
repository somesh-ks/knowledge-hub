# Singularity: runbook

Operations for the owner. Short, imperative, in the order you need it.

Status: updated 2026-10-06 against the built code. Correct a step here when it turns out wrong. `npm run singularity -- <command>` runs the engine CLI; `--help` on any command lists its flags.

Repository: `somesh-ks/knowledge-hub` (private). Site: `news.someshks.work`.

---

## 1. First-time setup

Accounts for Anthropic, Google AI Studio (Gemini), TypeSafe, Exa, Firecrawl and Speechify already exist (D13 in [decisions](decisions/foundations.md)). You also need GitHub, Vercel (Hobby) and Cloudflare (DNS only).

**Cost.** About 2 USD per month, dominated by Exa. Judgments cost about 0.01 USD per run and the writer under 0.07 USD per run. Speechify, Vercel Hobby, GitHub Actions (about 120 of 2,000 free minutes) and Cloudflare DNS use free tiers. Details: `git show 91bc533:docs/plan/build-plan.md` Section 10.

**Privacy.** The site is public but unlisted: `noindex` headers, `robots.txt` disallow, no sitemap, no inbound links. Anyone with the URL can read it, and the Blob audio URLs are public. The repository is private. Put nothing in a digest that you would not show a stranger who has the link.

Never paste a key into chat. The agent cannot read `.env`; keep it that way.

### 1.1 Prerequisites

1. Install Node 24 or newer (`.nvmrc` pins the version).
2. From the repository root, run `npm ci`.
3. Log in to GitHub: `gh auth login`.
4. Optional: log in to Vercel (`npx vercel login`) to use the CLI for the Blob store or env checks. Creating the project needs only the dashboard.

### 1.2 Create `.env` and add the service keys

1. Copy the template: `cp .env.example .env`. `.env` is gitignored.
2. In an editor, fill in the keys below. Leave a value empty to skip it: the script sends only non-empty values, and the engine uses its defaults for `SPEECHIFY_VOICE_ID` (`geffen_32`).

| Name | Where to get it |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic console. Create a key used only for this project; it serves Claude Sonnet and Haiku |
| `ANTHROPIC_ADMIN_KEY` | Anthropic console, Settings, Admin keys (optional: the Costs page reads Anthropic's bill with it, D183; Vercel only) |
| `TYPESAFE_API_KEY` | console.typesafe.ai |
| `EXA_API_KEY` | Exa dashboard |
| `FIRECRAWL_API_KEY` | Firecrawl dashboard |
| `GEMINI_API_KEY` | Google AI Studio (optional: YouTube transcription, topic emoji backup on Vercel) |
| `SPEECHIFY_API_KEY` | Speechify API console |
| `SPEECHIFY_VOICE_ID` | Plain configuration, no secret |
| `BLOB_READ_WRITE_TOKEN` | Section 1.5 |
| `SINGULARITY_GIT_NAME`, `SINGULARITY_GIT_EMAIL` | Plain configuration, no secret. `Somesh Kesarla Suresh` and `26426782+somesh-ks@users.noreply.github.com` (section 1.4) |
| `GITHUB_SINGULARITY_TOKEN`, `GITHUB_REPOSITORY` | Section 1.7 |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | You choose them; the command center's sign-in (section 1.4a). Sent to the admin project; the secret also goes to the reader (its `/api/costs` and `/api/health` verify the session, D257) |
| Models | Not env vars: `config/models.json` routes each step (Section 1.3) |

### 1.3 Pick the writer model

Models are not chosen in `.env` or Settings. `config/models.json` lists, per step, an ordered chain of model families (jev, claude-sonnet, claude-haiku, gemini-flash, gemini-flash-lite; never Opus, Gemini Pro or Nebius). At run start the engine lists each provider's models and uses the newest of each family; `fallback_id` is used when listing fails and `pin` forces an id. Jev is the exception: its id is fixed in code (`DEFAULT_JEV_MODEL`, `judge/jev.ts`), so that cached judgements stay valid, and the `jev` entry only names it in the run log. With `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` in `.env`:



3. Compare candidates before trusting one. This calls Jev and the routed models with your keys and costs a few cents:

```bash
npm run singularity -- eval --yes --only bakeoff --models <id>,<id>
```

### 1.4 Create the Vercel project

Vercel deploys through its GitHub integration (D25). No Vercel token is needed in GitHub or `.env`.

1. In the Vercel dashboard, choose Add New, Project, and import the GitHub repo `knowledge-hub`. Name the project `knowledge-hub`; the production branch is `main`.
2. Set Root Directory to `apps/web`. Leave "Include source files outside the Root Directory" on (the default). `apps/web/vercel.json` already sets the install, build and ignore commands.
3. Add the two Vercel environment variables (`GITHUB_SINGULARITY_TOKEN`, `GITHUB_REPOSITORY`) in section 1.9, or by hand in the dashboard.
4. Hobby deploys only commits authored by the Hobby team owner. The GitHub login connected to Vercel must be the account that owns the team, and it must match the committer. The engine commits as that owner through the GitHub Actions variables `SINGULARITY_GIT_NAME` and `SINGULARITY_GIT_EMAIL`, which section 1.9 sends. If both are unset the engine commits as `singularity-bot`, and Hobby blocks those deploys.

### 1.4a Create the admin project (D224)

The command center is a second Vercel project, `singularity-admin`, from the same repo: Root Directory `apps/admin`, "Include source files outside of the Root Directory" on, Production Deployment Protection off (the app gates itself; Vercel protection cannot guard a project reached through a rewrite). The reader's `apps/web/vercel.json` rewrites `/admin` to its `singularity-admin-psi.vercel.app` address. Set `ADMIN_PASSWORD` (a long random password) and `ADMIN_SESSION_SECRET` (a random string of 32 or more characters) in `.env`; `npm run secrets:push` sends them to this project once `apps/admin` is linked (`cd apps/admin && npx vercel link`), or add them by hand under the project's Environment Variables (Production). Until both exist the app answers 503 to everyone. The Experiments switches (D249) also need `DATABASE_URL` and `SINGULARITY_CONFIG_STORE=postgres` on this project, the same values the reader has (Production); without them the page shows the last deploy and its switches stay still.

The design guide is a third project, `singularity-design`, with Root Directory `apps/design` and the same options. The reader's `apps/web/vercel.json` rewrites `/design` to its `singularity-design.vercel.app` address. Its first production deploy comes from the next push to `main`; merge the rewrite only after that deploy is Ready, or `/design` answers 404.

### 1.5 Create the Blob store

1. In the Vercel dashboard, open Storage and create a Blob store (or run `vercel blob store add`).
2. Set the access to public.
3. Connect the store to the project. This also injects the token into Vercel.
4. Copy the `BLOB_READ_WRITE_TOKEN` value Vercel shows for the store into `.env`.

### 1.6 Add the domain and the DNS record

1. In the project's Domains settings, add `news.someshks.work`.
2. Note the CNAME target Vercel shows. It is also in the project's Domains settings.
3. In Cloudflare, open DNS for `someshks.work` and add one record: type CNAME, name `news`, target the value from Vercel, proxy status DNS only (grey cloud).
4. Wait until Vercel marks the domain valid. Vercel issues the certificate.

Do not add `www.news.someshks.work`. Do not turn the Cloudflare proxy on.

### 1.7 Create the GitHub token

1. In GitHub, open Settings, Developer settings, Fine-grained personal access tokens.
2. Create a token with resource owner `somesh-ks`, access to the `knowledge-hub` repository only, and these repository permissions: Actions read and write, Variables read and write, Contents read. Nothing else.
3. Set an expiry and record it in section 6.
4. Put the token in `.env` as `GITHUB_SINGULARITY_TOKEN`. Set `GITHUB_REPOSITORY=somesh-ks/knowledge-hub`.

### 1.8 No passphrase

The site has no passphrase (D160): anyone who opens it can start runs and narration inside the caps. If `GENERATE_PASSPHRASE_HASH` is still set in Vercel or `.env`, delete it; nothing reads it.

### 1.9 Send the secrets

Run this after sections 1.2 to 1.8. The Vercel part needs the project from section 1.4 and a Vercel login (`npx vercel login`); otherwise add the three Vercel variables in the dashboard.

1. Preview: `npm run secrets:push -- --dry-run`.
2. Send: `npm run secrets:push`. Use `-- --only github` or `-- --only vercel` to send one side.
3. The script reads `.env` and sends each non-empty value to GitHub Actions secrets, GitHub Actions variables or the Vercel production environment, with the value on stdin. It prints names and results, never values. Which name goes where is in `scripts/pushSecrets.ts`.
4. Check the names arrived:

```bash
gh secret list -R somesh-ks/knowledge-hub
gh variable list -R somesh-ks/knowledge-hub
```

For the Vercel side, open the project's Settings, Environment Variables in the dashboard (or run `npx vercel link` once, choose the existing `knowledge-hub` project, then `cd apps/web && npx vercel env ls production`).

### 1.10 Check the setup

Run `npm run singularity -- doctor --online`. It checks Node, git, config, state and key names, then makes authenticated requests: the Anthropic and Gemini model lists must answer, Jev answers a trivial question, Exa answers one search (about 0.007 USD), Firecrawl reports credits, Speechify lists the voice id, Vercel Blob accepts a list call and the site's GitHub token opens the repository and reads Actions variables (with its expiry; write access cannot be tested). Fix every `fail` and read every `warn` before going on.

### 1.11 Push `main` and deploy

1. Push the code: `git push origin main`. The workflows must be on the default branch before `gh workflow run` can start them.
2. The push starts a Vercel build and deploy; `ci.yml` ran on the pull request (D148). Vercel does not wait for `ci.yml`, so a failing check does not stop a deploy. To audio-process by hand, run `gh workflow run audio.yml -R somesh-ks/knowledge-hub`.
3. Watch the checks: `gh run watch -R somesh-ks/knowledge-hub`. Watch the deploy in the Vercel dashboard. This is the first live build of the `apps/web` workspace through the Git integration, so read any build error there.
4. Open `https://news.someshks.work`. With no digest yet it shows "No briefings yet".

### 1.12 First manual run

```bash
gh workflow run run.yml -R somesh-ks/knowledge-hub -f mode=on-demand
gh run list -R somesh-ks/knowledge-hub --workflow run.yml --limit 1
gh run watch <run id> -R somesh-ks/knowledge-hub
```

Add `-f dry_run=true` to run every stage with nothing written or pushed. It still spends API credit. A real run commits `chore(digest): <date>`, then Vercel deploys the text within minutes. `audio.yml` narrates, uploads and pushes the timeline, and a second Vercel deploy adds the audio, so the player shows no audio until then. If the outcome is `nothing`, the first window was quiet; run again with `-f since=<date>` for a wider window.

### 1.13 First-run checklist for the iPhone

Do this on the current iOS, once a digest with audio is live. Note the iOS version for any failure.

1. Open the site in Safari. Tap Share, then Add to Home Screen. Open the app from the home screen: it runs full screen.
2. Open the latest briefing and tap play. Lock the phone. The lock screen shows one track, "Singularity", with the cover. Check play, pause, the 15 second skips, previous and next item, and that the scrubber moves.
3. On the lock screen, drag the scrubber, then unlock and tap another item's play button. Seeking must work; if only seeking fails, it is the Blob Range risk (`git show 91bc533:docs/plan/build-plan.md` Section 14).
4. Flip the silent switch. Narration keeps playing; interface sounds go quiet. Flip it back and open Settings: the switch and volume control the sounds.
5. Change the speed, rotate the phone, and trigger a notification or call during playback. After a call the player offers to resume and does not start by itself.
6. Switch to airplane mode and relaunch: the last briefing opens and the banner says you are offline.
7. Open Regenerate and tap the comments field: the page must not zoom. Do not run Generate yet unless you want a second digest.

---

## 2. Daily operation

Nothing to do on most days.

- A scheduled run starts in the hour chosen in Settings, Schedule (07:00 to 07:59 Stockholm time by default): Vercel Cron calls `/api/cron/run` every hour, and in that hour it dispatches `run.yml` when the gate says something is due (D61). A regular digest is due every second day, and a weekly digest follows on Sundays. GitHub's own schedule still fires, hours late, as a fallback that ends gated once the briefing exists.
- The trigger needs `CRON_SECRET` on Vercel: a random value of 16 or more characters in `.env` (for example `openssl rand -hex 24`), sent with `npm run secrets:push -- --only vercel`. Vercel sends it with every cron call, and the route refuses calls while it is missing. To check, open the project's Cron Jobs page in the Vercel dashboard: each call's log line says whether it dispatched.
- The digest lands as a `chore(digest): <id>` commit, and the site updates within minutes.
- GitHub emails you when a scheduled run fails. That is the only notification (D11).
- Read the briefing at `news.someshks.work`, installed to the iPhone home screen.
- Once a week, run `/learn` with one sentence about what the last digests got wrong (section 9).

Monthly:

1. Run `npm run singularity -- status` and read the failing sources. Fix or drop any that fail five runs in a row.
2. Check balances: Anthropic and Gemini balances, Exa, Speechify characters (`state/usage.json`), the TypeSafe console, Vercel Blob usage.
3. Check the token expiry dates in section 6.

---

## 3. What each workflow does

| Workflow | Starts when | Does |
| --- | --- | --- |
| `run.yml` | Dispatched by `/api/cron/run` in the schedule's hour, its own hourly schedule as a late fallback, or on demand | Runs the engine stage by stage (Gate, Fetch, Judge, Write, Validate), commits the digest and state (Commit) as the owner identity, then calls `audio.yml` when a digest was published or a digest from the last 7 days still lacks audio |
| `audio.yml` | Called by `run.yml`, or on demand | Checks out `main`, runs `singularity publish --prune 120` (Audio: narrates digests that lack audio, uploads to Blob, prunes, then commits and pushes the timeline metadata as the owner). That push triggers a second Vercel deploy |
| `ingest.yml` | Three times a day, or on demand | Runs `singularity ingest` (D233): reads the free sources and saves each new story's text to Blob and Neon. Reads the config store; commits nothing; spends no paid call |
| `ci.yml` | A pull request | Runs typecheck, lint, tests and the build when code changed, always gitleaks and the audit, and both browser suites for some paths (D148). It does not deploy |
| `branches.yml` | A pull request closing, daily, or on demand | Deletes the head branch of a closed pull request, and daily every branch whose pull requests are all closed (one with an open pull request, or none, stays). With the `NEON_API_KEY` secret and `NEON_PROJECT_ID` variable it also deletes Neon `preview/*` branches whose git branch is gone and keeps the newest two |
| `podcast.yml` | The app's Catch up, Regenerate and Delete, or on demand | Writes, regenerates or deletes one episode and commits it under `Podcasts/`; the commit does not deploy (D199), `content.yml` mirrors it. Has its own queue (`singularity-podcast`), so an episode and a digest can run at the same time |
| `config.yml` | The app's settings, one change per run, or on demand with the required `op` JSON string | Applies one config change (a topic, a source or a weight) as one commit through the write guard (D149). Shares `run.yml`'s queue |
| `content.yml` | After a workflow that commits content, a push of `Digests/` or `Podcasts/` to `main`, or on demand | Mirrors the content into the Blob store the pages read (`singularity content sync`). Safe to rerun; run it by hand to fill an empty store (D173) |
| `health.yml` | Daily, or on demand (drill) | Runs `singularity health`; a fault opens one `health` issue and heals a missed run once, warnings go to one `health-warnings` issue on Mondays ([hardening](engineering/hardening.md)). A drill proves the healing path without a real fault |
| `smoke.yml` | After each production deploy and every three hours | Asks the live site five read-only questions (server, settings, GitHub token, home page, Library); a failure opens or comments on one `smoke` issue and the next pass closes it (D159) |
| `browser.yml` | A push to `main` that changes the site, nightly, or called by `ci.yml` | Runs the two browser suites, the only checks that see CSS and layout (D148). Red check: [delivery failures](engineering/delivery-failures.md) |
| `design-system.yml` | A pull request that touches the design system | Checks the `design-system` label and that a labelled PR holds only the system, the code that calls it, the guide and docs (D254). Reads the diff only |
| `episode-eval.yml` | The `eval` label on a pull request, or on demand | Scores the episode fixtures with Jev and Sonnet, before and after a writer prompt change (D180). Paid calls, so only on request |
| `automerge.yml` | After `ci.yml` passes | Squash-merges a Dependabot pull request; anything else waits for you. Its token cannot merge a pull request that edits `.github/workflows`: merge those by hand |
| `seed.yml` | By hand only | Seeds the config store from the committed config with the `DATABASE_URL` secret; dry run by default (section 11) |

Vercel itself builds every push to `main`, except pushes that touch nothing the site reads (`state`, `config`, docs and `.github`). A published digest therefore deploys twice: the text first, then the audio.

Other branches do not deploy (`git.deploymentEnabled` in `apps/web/vercel.json` and `apps/admin/vercel.json`), except ones named `preview/<name>`: push a branch under that name when you want a preview URL. Every preview made Neon's Vercel integration create a database branch, and on 2026-10-22 the free plan's branch limit filled and every preview failed ("Branch limit reached"). `branches.yml` removes what is left.

Every `run.yml` run ends in one outcome:

| Outcome | Meaning | What to do |
| --- | --- | --- |
| `published` | A digest was written and committed | Nothing |
| `gated` | A regular digest is not due yet | Nothing. Use an on-demand run if you want one now |
| `nothing` | Fewer than three items cleared the bar | Nothing. The site shows no notice; the home page keeps the latest podcast. |
| `failed` | A stage failed | Read the run (section 5). The window and seen list are untouched, so a rerun loses nothing |

---

## 4. Run on demand

Pick one. Each starts `run.yml` with `mode=on-demand`, which skips the gate.

1. **Site button.** Open the Generate sheet and watch the progress steps. Limits: one new on-demand run per 6 hours and three per 24 hours, counting runs started any other way. A regeneration of an existing podcast has no daily limit of its own, only a ceiling of 25 runs a day of the workflow: each podcast takes three (D212).
2. **GitHub CLI.**

```bash
gh workflow run run.yml -R somesh-ks/knowledge-hub -f mode=on-demand
gh run list -R somesh-ks/knowledge-hub --workflow run.yml --limit 1
gh run watch <run id> -R somesh-ks/knowledge-hub
```

3. **The `sk-dispatch` skill.** Ask it to run. It works from any directory, applies the same limits and watches the run (D16).

Other inputs on `run.yml`: `mode` (`on-demand`, `scheduled`, `weekly`), `force`, `since` and `dry_run`. From a clone, `/digest` runs it locally, in agent mode, or remotely.

A second run on the same day writes `YYYY-MM-DD-2`. It never overwrites a digest.

---

## 5. Read a failed run

1. Find the run: `gh run list -R somesh-ks/knowledge-hub --workflow run.yml --limit 5`.
2. Show the failing step: `gh run view <run id> -R somesh-ks/knowledge-hub --log-failed | head -n 60`.
3. Read the job summary on the run page. It lists counts and source status only.
4. Match the failing step:

| Step | Usual cause | Fix |
| --- | --- | --- |
| Fetch | The network is down or every source failed. One failing source is logged, not fatal | Rerun. Check `singularity status` for sources failing repeatedly |
| Judge | Both judges were unavailable, so most of the pool went unjudged. A Jev failure alone falls back to the Haiku or Flash-Lite judge | Section 8.4 |
| Write | a model not found, key rejected, the token budget aborted the run, or extraction or the writer was down | Section 8.3 |
| Validate | A digest-level validation error, named in the log. Too few surviving items is not a failure: the outcome is `nothing` | Read the log, then rerun |
| Commit | The write guard refused a path outside the command's list, or the push conflicted three times | A guard refusal is a bug: open an issue with the log. For a conflict, pull and rerun |
| `audio.yml`: Audio | A refused commit or a push that failed after three rebase retries. A failed narration, a missing key or a failed prune is only a warning | Section 8.2 |
| Vercel deploy (not a workflow step) | A build error, or a skipped or blocked deploy; read it in the Vercel dashboard | Section 8.5 |

5. Rerun only the failed jobs: `gh run rerun <run id> -R somesh-ks/knowledge-hub --failed`.

Logs redact known key patterns. If you see a key in a log anyway, revoke it first, then rotate it (section 6).

---

## 6. Rotate keys

Rotate on a schedule, after any suspected leak, and before expiry. If a key appears in chat, a log or a commit, revoke it first, then replace it.

1. Create the new key at the service. Delete the old one after the new one works.
2. Edit the value in `.env`.
3. Run `npm run secrets:push`.
4. If the value feeds Vercel (`GITHUB_SINGULARITY_TOKEN`, `GITHUB_REPOSITORY`), redeploy from the Vercel dashboard (Deployments, Redeploy on the latest production deployment). Vercel applies new environment values only to new deployments.

| Key | Rotate at | Used by |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic console | Story and script writers, Haiku fallbacks |
| `TYPESAFE_API_KEY` | console.typesafe.ai | Jev judge and grounding check |
| `EXA_API_KEY` | Exa dashboard | Discovery |
| `FIRECRAWL_API_KEY` | Firecrawl dashboard | Extraction, Alexandria facts, YouTube transcripts (D165) |
| `GEMINI_API_KEY` | Google AI Studio | YouTube transcription fallback, topic emoji backup (also sent to Vercel) |
| `SPEECHIFY_API_KEY` | Speechify API console | Audio |
| `BLOB_READ_WRITE_TOKEN` | The Blob store's settings in Vercel | Audio upload and prune |
| `GITHUB_SINGULARITY_TOKEN` | GitHub, Fine-grained personal access tokens | Generate button, workflow dispatch, reads and cancels, Actions variable writes, the scheduled dispatch (`/api/cron/run`) |

Track expiry here. Fill the dates when you create each token and set a calendar reminder two weeks before.

| Token | Created | Expires | Renew by |
| --- | --- | --- | --- |
| `GITHUB_SINGULARITY_TOKEN` | | | |
| `VERCEL_TOKEN` (optional, the audio workflow's CLI fallback) | | | |

When `GITHUB_SINGULARITY_TOKEN` expires, the Generate button stops working ("The server ran into a problem, so no briefing was started. Error ref ...") and `/api/cron/run` can no longer start the on-time scheduled run; GitHub's own schedule remains a fallback, so a briefing may come late. `run.yml` itself uses the built-in workflow token. `VERCEL_TOKEN` is optional: the audio workflow's Vercel CLI fallback uses it when `BLOB_READ_WRITE_TOKEN` is absent, so track its expiry here when you set one.

---

## 7. Prune audio

Vercel Hobby holds 1 GB of Blob storage. A four-minute digest is about 4 MB at the engine's 128 kbps default, so audio uploaded more than 120 days ago is deleted.

- `audio.yml` calls `singularity publish --prune 120`, and the prune itself runs on Sundays (UTC), because listing `audio/` costs Blob operations. A scheduled run at 03:17 UTC on Sundays makes sure it happens even in a week with no publish.
- To prune now, run `gh workflow run audio.yml -R somesh-ks/knowledge-hub -f prune_now=true`.
- A pruned digest keeps its text, its timeline and its `audio` field. Its player reports that the audio is not available.
- Check usage in the Vercel dashboard under Storage. If usage nears 1 GB, shorten the retention in `audio.yml`.

---

## 8. Troubleshooting

### 8.1 A digest did not arrive

1. Run `npm run singularity -- status`. A regular digest is due every second day, so a quiet day can be correct (`gated`).
2. Check the last runs: `gh run list -R somesh-ks/knowledge-hub --workflow run.yml --limit 5`.
3. No run at 07:13: GitHub can delay or drop scheduled runs. The next daily trigger widens the window, so nothing is lost. Start an on-demand run to get it now.
4. Run exists but the outcome is `nothing`: fewer than three items cleared the bar. Normal on a quiet day.
5. Outcome is `failed`: read the run (section 5).
6. Workflow disabled: `gh workflow list -R somesh-ks/knowledge-hub --all`. Enable it with `gh workflow enable run.yml -R somesh-ks/knowledge-hub`.

### 8.2 Audio is missing

1. The page says "Audio is still being prepared": the text digest published but speech failed (D23). Run `gh workflow run audio.yml -R somesh-ks/knowledge-hub`. `singularity publish` retries every digest whose `audio` is null.
2. Still failing: check `state/usage.json`. The engine stops at 90 percent of the monthly Speechify allowance (`SPEECHIFY_MONTHLY_CHARS`, default 500,000). Wait for the next month or raise the plan.
3. A recent digest points at a deleted Blob file: delete its `.audio.json`, set `audio: null` in the digest frontmatter, commit, then run `audio.yml`.
4. An old digest has no working player: its audio was pruned. That is expected (section 7).
5. Playback starts but seeking fails on iPhone only: this is the Blob Range risk (`git show 91bc533:docs/plan/build-plan.md` Section 14). Record the iOS version and report it.

### 8.3 A model id changed or was retired

Models are resolved at run start from the providers' lists. Symptoms: the run log warns "A model failed; falling back" with `model_not_found`, or `singularity models` shows a family on its fallback id. Run `npm run singularity -- models`, then set `pin` or `fallback_id` for that family in `config/models.json`.

### 8.4 Jev is unavailable

1. A 429 or 529 means rate limit or an outage. The engine retries with backoff, then the routed fallback judge answers the items Jev could not. The run log warns when it does.
2. A 401 means the key was revoked or expired. Rotate `TYPESAFE_API_KEY` (section 6).
3. With `TYPESAFE_API_KEY` unset, the routed fallback judge answers alone, the grounding check is skipped and the digest is `verified: false`.
4. If Jev stays down for days, check the TypeSafe console for status, balance and version retirements. The fallback judge is less calibrated, so scores shift. Revalidate thresholds with `singularity eval --yes --only judges,grounding` before trusting them again.

### 8.5 The site did not update

1. Open the project's Deployments in the Vercel dashboard and read the latest deployment. After a run concludes, the site updates when Vercel finishes, usually a minute or two.
2. No deployment appeared, or it says blocked: Hobby accepts only commits authored by the team owner. Check that `SINGULARITY_GIT_NAME` and `SINGULARITY_GIT_EMAIL` are set (`gh variable list -R somesh-ks/knowledge-hub`), that the commit author is the owner, and that the GitHub login connected to Vercel matches.
3. A deployment shows as skipped (Canceled by Ignored Build Step): the push touched nothing the site reads, which is expected for `state`, `config`, docs and `.github`. If a digest push was skipped, check the `ignoreCommand` in `apps/web/vercel.json`; `singularity health` warns `site_behind` when this happens, and faults (the `health` issue) once the oldest commit the site lacks is a day old (D159). Vercel refuses an `ignoreCommand` over 256 characters (the whole deploy fails), so keep it short. Hobby also refuses every deploy at 100 in a rolling 24 hours, cancelled builds included ("Deployment rate limited"); `health` warns `deploy_rate` at 70 (D247), and the cure is to find the project that builds more than merges explain.
4. A build error about missing packages or paths: check Root Directory is `apps/web`, "Include source files outside of the Root Directory" is on, and the `installCommand` in `apps/web/vercel.json` runs `npm ci` from the repository root.
5. `news.someshks.work` shows an old page but the deploy succeeded: wait a minute, then hard refresh. Check that the DNS record is DNS only. A proxied record (orange cloud) breaks certificate issuance.

### 8.6 The Generate button fails

| Message | Cause | Fix |
| --- | --- | --- |
| "Generate is on cooldown. Try again in ..." or "Generate has reached its limit for today. Try again in ..." | One run in 6 hours, or three in 24 hours | Wait. Runs started by `gh` or the skills count too |
| "The server ran into a problem, so ... Error ref 3f9a1c." (Create, Generate, Regenerate, Delete, saving settings) | The function answered but could not do the job: a Vercel variable is missing or malformed, or GitHub refused the dispatch (expired or under-privileged token) | Search the Vercel function logs for `ref 3f9a1c`: the lines name the missing variable or GitHub's answer. Then fix the variable, or rotate `GITHUB_SINGULARITY_TOKEN` (section 6) |
| "The server crashed before it could answer ..." | The function failed before it ran (a broken deploy, a missing native binary) or threw | Open the deployment's function logs in Vercel; redeploy or roll back. A thrown error is logged as `[api/...] [ref ...] crashed:` |

---

## 9. Add a source and teach the taste model

### 9.1 Add a source

1. Add a row to `config/sources.md` under the right category.
2. Run `npm run singularity -- sources import`. It rebuilds `config/sources.json` from the list, keeping what discovery already found. The new source's id is its name in lowercase with hyphens.
3. Run `npm run singularity -- sources discover --only <id>`. It finds and verifies the feed. A site with no feed becomes a Firecrawl scrape source.
4. Run `npm run singularity -- sources check --only <id>` and confirm the source answers.
5. Commit both files as `feat(sources): add <name>` and push. Bot runs cannot change `config/`, so this is always a manual commit.

### 9.2 Teach with `/learn`

1. In the repository, run `/learn` with one sentence, for example "more shaders, less VC funding". From any other folder, ask `sk-dispatch` to learn.
2. Read the diff. The change is bounded: at most 0.05 per weight and 0.15 in total per call.
3. Accept it. The skill applies it through `singularity learn --apply`, commits as `chore(prefs): ...` and pushes.
4. The next run uses the new weights. Cached judgments are re-scored with no new calls.

Do not edit `config/preferences.json` by hand. To undo, revert the `chore(prefs)` commit.

---

## 10. Restore from git

Git holds the code, config, digests, state and docs. It does not hold secrets (`.env`, GitHub secrets, Vercel variables) or audio (Vercel Blob).

| Situation | Steps |
| --- | --- |
| A bad digest | Run `git revert <sha>` on its `chore(digest)` commit and push. The revert also restores `state/`, so the next run covers the same window again |
| A bad edit to one file | `git checkout <sha> -- <path>`, commit, push |
| Laptop lost | Clone `https://github.com/somesh-ks/knowledge-hub.git`, run `npm ci`, recreate `.env` from the services (reissue keys if needed), run `npm run secrets:push` only if the stores lost their values |
| GitHub repository lost | Any clone is a full copy. Create a new private repository, push, then repeat section 1.9 and update `GITHUB_REPOSITORY` |
| Audio lost | Remove the digest's `.audio.json`, set `audio: null`, commit, run `audio.yml`. It regenerates at a cost in Speechify characters |
| Vercel project lost | Repeat sections 1.4 to 1.6 and 1.9, then push to `main` or redeploy from the dashboard |

---

## 11. The config store (D149)

Off by default. With it on, a settings edit is saved to Neon Postgres and shows on every device within about a second, with no workflow and no rebuild; each briefing's commit keeps a copy in git. It is on only where `SINGULARITY_CONFIG_STORE=postgres` is set beside `DATABASE_URL`: `DATABASE_URL` alone never turns it on.

### 11.1 Switch on

1. The workflows already pass the store to the engine: `run.yml`'s Gate step and `podcast.yml`'s Podcast step read `DATABASE_URL` (secret) and `SINGULARITY_CONFIG_STORE` (variable); either one unset keeps them on the committed files.
2. GitHub secret `DATABASE_URL`: the Neon connection string (Vercel → Storage → the Neon database → Connect; `vercel env pull` writes `[SENSITIVE]` for a hidden value, which is not the string). Settings → Secrets and variables → Actions → New repository secret, or `npm run secrets:push -- --only github` from `.env`.
3. Seed from GitHub: Actions → seed → Run workflow on `main`. The default is a dry run that lists what it would write; run it again with dry run unticked. It never replaces a row, and it creates the shared rate-limit table (D150). From a laptop instead: `DATABASE_URL` in `.env`, then `npm run singularity -- config seed --dry-run` and `npm run singularity -- config seed`.
4. Refresh the rows if the database was seeded earlier (it was, on 2026-10-22): a config change committed since then is in git but not in the rows. With `SINGULARITY_CONFIG_STORE` still unset everywhere, run seed with replace ticked (dry run first: it lists the rows that differ). It refuses once the store is on, since the app's edits then live only in the database; the workflow cannot force it (`--force` exists on a laptop only; do not use it after switch-on).
5. Make sure no edit is waiting: no `config.yml` run is queued between the refresh and step 6.
6. GitHub variable: Settings → Secrets and variables → Actions → Variables → `SINGULARITY_CONFIG_STORE` = `postgres`.
7. Vercel: Project → Settings → Environment Variables → `SINGULARITY_CONFIG_STORE` = `postgres` for Production. Check that `DATABASE_URL` is set for Production too. On 2026-10-23 it was not: the Neon integration was connected with the `NEON_` prefix (`NEON_DATABASE_URL` and friends), which nothing reads, so the store and the shared rate counter (D150) have never run in production. Either set the integration's prefix to none (Storage → the Neon database → Settings) or add `DATABASE_URL` by hand with the pooled connection string.
8. Redeploy (Deployments → the latest → Redeploy): the pages read the switch when they are built.
9. Check: `https://news.someshks.work/api/config` answers 200 with `"ops":[]`; change a weight on the phone and reload the same page on the laptop: it shows the new weight. The next run's log says `config store: files current` or names the files it copied.

### 11.2 Switch off

1. Keep what was edited since the last run: `git pull`, then with `DATABASE_URL` and `SINGULARITY_CONFIG_STORE=postgres` in `.env`, `npm run singularity -- run --stage gate --dry-run` copies the stored files over `config/`, and `npm run singularity -- config commit --message "snapshot from the store"` commits and pushes them.
2. Vercel: delete `SINGULARITY_CONFIG_STORE`, then redeploy. The pages stop asking, `GET /api/config` answers 405 and an edit goes through `config.yml` again.
3. GitHub: delete the `SINGULARITY_CONFIG_STORE` variable. Runs read the committed files again. The secret and the table can stay; nothing reads them while the switch is off.
4. Remove `SINGULARITY_CONFIG_STORE` from `.env`.

If the database is down while the store is on, nothing breaks: pages show the build's copy, runs use the last commit's files, and an edit answers "unavailable" and stays pending on the page.

## 12. Branch rules on `main` (D175)

`main` is protected by a GitHub ruleset, kept as `.github/rulesets/main.json` so it is reviewed like code and can be re-imported. Rulesets on a private repository need GitHub Pro; the page says so if the plan lacks it.

1. Settings → Rules → Rulesets → New ruleset → Import a ruleset → choose `.github/rulesets/main.json` → Create. Or with the API: `gh api -X POST repos/somesh-ks/knowledge-hub/rulesets --input .github/rulesets/main.json`.
2. What it holds, and why each rule is there:
   - No deletion, no force push, linear history: `main`'s record is append-only; PRs land as squash merges (the only merge method the rule allows), which is how they have landed so far.
   - Every change goes through a pull request with its review threads resolved. No human approval count: one owner cannot approve their own PR, and code review is CodeRabbit (D143, D192).
   - Required checks `check` and `browser gate` from `ci.yml`, and the branch must be up to date with `main` when it merges (strict). Two PRs that each passed alone broke `main` on 2026-10-24 (the docs budget); strict checks run CI on the merged state. The cost: before each merge, Update branch, then wait for CI (about 4 minutes, 15 with the browser suites). `browser gate` always runs and passes when the suites passed or the path filter skipped them; the suites' own names (`browser / site suite`, `browser / player suite`) exist only when they run, so requiring either would hold every docs-only PR.
   - Bypass: the GitHub Actions app (integration 15368), always. The engine's workflows (`run.yml`, `audio.yml`, `podcast.yml`, `config.yml`, `automerge.yml`) push digests, narration, episodes and config straight to `main` with the workflow token; without this bypass every run would fail at its commit. No person bypasses: to make an exception, edit the ruleset.
3. Not required, on purpose: the `review` check, because Dependabot's PRs merge without the label (`automerge.yml`); signed commits, because the engine's commits are unsigned.
4. To change a rule, edit the JSON, import it over the existing ruleset (Settings → Rules → Rulesets → the ruleset → Import), and open a PR with the same change so the file matches.

## 13. Share links (D153)

Share makes a public listen link (`/s/<token>`). What a link does: [specs/sharing.md](specs/sharing.md).

1. Owner setup: nothing. The routes need `DATABASE_URL` on Vercel Production (section 11, step 7), which production has; without it Share sends the page's own address, as before. The tables `share_links` and `share_budget` create themselves on the first Share; there is nothing to seed or migrate.
2. Check: open a briefing whose audio has played once, More actions → Share, open the link in a private window and press Play.
