# Dispatch: runbook

Operations for the owner. Short, imperative, in the order you need it.

Status: written 2026-10-06, before the build is finished. The engine, web app and skills are being built in parallel, so a step that needs an unbuilt part works only once its phase lands ([build-plan.md](build-plan.md) Section 13). `npm run dispatch -- <command>` runs the engine CLI.

Repository: `somesh-ks/dispatch` (private). Site: `news.someshks.work`.

---

## 1. First-time setup

Accounts for Nebius, TypeSafe, Exa, Firecrawl and Speechify already exist (D13 in [decisions.md](decisions.md)). You also need GitHub, Vercel (Hobby) and Cloudflare (DNS only).

Never paste a key into chat. The agent cannot read `.env`; keep it that way.

### 1.1 Prerequisites

1. Install Node 24 or newer (`.nvmrc` pins the version).
2. Log in to GitHub: `gh auth login`.
3. Log in to Vercel: `npx vercel login`.
4. Install dependencies from the repository root: `npm ci`.

### 1.2 Create the Vercel project

1. Run `npx vercel link` from `apps/web`.
2. Create a new project. Accept the Astro framework preset.
3. Answer no when asked to connect the Git repository. Deploys come from GitHub Actions, not the Git integration.
4. Leave the project's Root Directory setting empty. The deploy commands already run from `apps/web`.
5. Open `apps/web/.vercel/project.json`. Copy `orgId` into `.env` as `VERCEL_ORG_ID` and `projectId` as `VERCEL_PROJECT_ID`. `.vercel/` is gitignored.
6. In Vercel, open Account settings, Tokens. Create a token with an expiry. Put it in `.env` as `VERCEL_TOKEN`. Record its expiry in section 6.

### 1.3 Create the Blob store

1. In the Vercel dashboard, open Storage and create a Blob store.
2. Set the access to public.
3. Connect the store to the project.
4. Copy the `BLOB_READ_WRITE_TOKEN` value Vercel shows for the store into `.env`.

### 1.4 Add the domain and the DNS record

1. Run `npx vercel domains add news.someshks.work` from `apps/web`.
2. Note the CNAME target Vercel shows. It is also in the project's Domains settings.
3. In Cloudflare, open DNS for `someshks.work` and add one record: type CNAME, name `news`, target the value from Vercel, proxy status DNS only (grey cloud).
4. Wait until Vercel marks the domain valid. Vercel issues the certificate.

Do not add `www.news.someshks.work`. Do not turn the Cloudflare proxy on.

### 1.5 Create the GitHub dispatch token

1. In GitHub, open Settings, Developer settings, Fine-grained personal access tokens.
2. Create a token with resource owner `somesh-ks`, access to the `dispatch` repository only, and these repository permissions: Actions read and write, Contents read. Nothing else.
3. Set an expiry. Record it in section 6.
4. Put the token in `.env` as `GITHUB_DISPATCH_TOKEN`. Set `GITHUB_REPOSITORY=somesh-ks/dispatch`.

### 1.6 Fill the rest of `.env`

1. Copy the template: `cp .env.example .env`.
2. Fill the values in an editor.

| Name | Where to get it |
| --- | --- |
| `NEBIUS_API_KEY` | Nebius Token Factory console. Create a key used only for this project and top up prepaid credit modestly |
| `TYPESAFE_API_KEY` | console.typesafe.ai |
| `EXA_API_KEY` | Exa dashboard |
| `FIRECRAWL_API_KEY` | Firecrawl dashboard |
| `SPEECHIFY_API_KEY` | Speechify API console |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Step 1.2 |
| `BLOB_READ_WRITE_TOKEN` | Step 1.3 |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPOSITORY` | Step 1.5 |
| `GENERATE_PASSPHRASE_HASH` | Step 1.7 |
| `NEBIUS_BASE_URL`, `DISPATCH_MODEL`, `DISPATCH_FALLBACK_MODEL`, `SPEECHIFY_VOICE_ID` | Plain configuration, no secret. See `.env.example` |
| `YOUTUBE_API_KEY` | Optional, only for the one-time YouTube channel lookup |

### 1.7 Create the Generate passphrase

1. Run `npm run passphrase`.
2. Type a long passphrase twice. Echo is off.
3. The script writes only the scrypt hash to `.env` as `GENERATE_PASSPHRASE_HASH`. Remember the passphrase; nothing stores it.

The passphrase is the only gate on the Generate button. Make it long.

### 1.8 Send the secrets

1. Run `npm run secrets:push`. Add `-- --dry-run` first to see what would be sent.
2. The script reads `.env` and sends each value to GitHub Actions (`gh secret set NAME`) and Vercel (`vercel env add NAME production`), with the value on stdin. It prints names and results, never values.
3. Check the names arrived:

```bash
gh secret list -R somesh-ks/dispatch
npx vercel env ls production
```

### 1.9 First deploy and check

1. Run `gh workflow run deploy.yml -R somesh-ks/dispatch`, then watch it with `gh run watch -R somesh-ks/dispatch`.
2. Open `https://news.someshks.work`.
3. Run `npm run dispatch -- doctor`. It checks Node, git, key names and each service.

`deploy.yml` exists once Phase 1 and Phase 5 land. Until then, deploy by hand with the three Vercel commands in [build-plan.md](build-plan.md) Section 10.

---

## 2. Daily operation

Nothing to do on most days.

- A scheduled run starts at 07:13 Stockholm time every day. A regular digest is due every second day, and a weekly digest follows on Sundays.
- The digest lands as a `chore(digest): YYYY-MM-DD` commit, and the site updates within minutes.
- GitHub emails you when a scheduled run fails. That is the only notification (D11).
- Read the briefing at `news.someshks.work`, installed to the iPhone home screen.
- Once a week, run `/learn` with one sentence about what the last digests got wrong (section 9).

Monthly:

1. Run `npm run dispatch -- status` and read the failing sources. Fix or drop any that fail five runs in a row.
2. Check balances: Nebius credit, Exa, Speechify characters (`state/usage.json`), the TypeSafe console, Vercel Blob usage.
3. Check the token expiry dates in section 6.

---

## 3. What each workflow does

| Workflow | Starts when | Does |
| --- | --- | --- |
| `run.yml` | Daily 07:13 Stockholm, or on demand | Runs the engine stage by stage (gate, fetch, judge, write, validate), commits the digest and state, then calls `deploy.yml` |
| `deploy.yml` | Called by `run.yml` and `ci.yml`, or on demand | Checks out `main`, runs `dispatch publish --prune` (audio, Blob upload, prune), then builds and deploys with the Vercel CLI |
| `ci.yml` | A pull request, or a push to `main` | Runs checks when code changed, always runs gitleaks, then calls `deploy.yml` on `main` |

Every `run.yml` run ends in one outcome:

| Outcome | Meaning | What to do |
| --- | --- | --- |
| `published` | A digest was written and committed | Nothing |
| `gated` | A regular digest is not due yet | Nothing. Use an on-demand run if you want one now |
| `nothing` | Fewer than three items cleared the bar | Nothing. The site says "Nothing cleared the bar." |
| `failed` | A stage failed | Read the run (section 5). The window and seen list are untouched, so a rerun loses nothing |

---

## 4. Run on demand

Pick one. All three start `run.yml` with `mode=on-demand`, which skips the gate.

1. **Site button.** Open the Generate sheet, enter the passphrase, watch the progress steps. Limits: one on-demand run per 6 hours and three per 24 hours. The count includes runs started any other way.
2. **GitHub CLI.**

```bash
gh workflow run run.yml -R somesh-ks/dispatch -f mode=on-demand
gh run list -R somesh-ks/dispatch --workflow run.yml --limit 1
gh run watch <run id> -R somesh-ks/dispatch
```

3. **The `sk-dispatch` skill.** Ask it to run. It works from any directory and watches the run (D16).

Other inputs on `run.yml`: `mode` (`scheduled`, `on-demand`, `weekly`), `force`, `since` and `dry_run`.

A second run on the same day writes `YYYY-MM-DD-2`. It never overwrites a digest.

---

## 5. Read a failed run

1. Find the run: `gh run list -R somesh-ks/dispatch --workflow run.yml --limit 5`.
2. Show the failing step: `gh run view <run id> -R somesh-ks/dispatch --log-failed | head -n 60`.
3. Read the job summary on the run page. It lists counts and source status only.
4. Match the failing step:

| Step | Usual cause | Fix |
| --- | --- | --- |
| `fetch` | The network is down or every source failed. One failing source is logged, not fatal | Rerun. Check `dispatch status` for sources failing repeatedly |
| `judge` | Jev key rejected (401), rate limited (429), or unavailable | Section 8.4 |
| `write` | Nebius model not found, key rejected, or the token budget aborted the run | Section 8.3 |
| `validate` | Too few items survived the voice and grounding checks | Not a failure: the outcome is `nothing` |
| `commit` | The write guard blocked a path outside the command's list, or the push conflicted three times | A guard block is a bug: open an issue with the log. For a conflict, pull and rerun |
| `deploy` | Speechify or Blob error in `dispatch publish`, or a Vercel auth or path error | Sections 8.2 and 8.5 |

5. Rerun only the failed jobs: `gh run rerun <run id> -R somesh-ks/dispatch --failed`.

Logs redact known key patterns. If you see a key in a log anyway, revoke it first, then rotate it (section 6).

---

## 6. Rotate keys

Rotate on a schedule, after any suspected leak, and before expiry. If a key appears in chat, a log or a commit, revoke it first, then replace it.

1. Create the new key at the service. Delete the old one after the new one works.
2. Edit the value in `.env`.
3. Run `npm run secrets:push`.
4. If the value feeds Vercel (`GITHUB_DISPATCH_TOKEN`, `GITHUB_REPOSITORY`, `GENERATE_PASSPHRASE_HASH`), redeploy: `gh workflow run deploy.yml -R somesh-ks/dispatch`. Vercel applies new environment values only to new deployments.

| Key | Rotate at | Used by |
| --- | --- | --- |
| `NEBIUS_API_KEY` | Nebius Token Factory console | Writer and fallback judge |
| `TYPESAFE_API_KEY` | console.typesafe.ai | Jev judge |
| `EXA_API_KEY` | Exa dashboard | Discovery |
| `FIRECRAWL_API_KEY` | Firecrawl dashboard | Extraction |
| `SPEECHIFY_API_KEY` | Speechify API console | Audio |
| `BLOB_READ_WRITE_TOKEN` | The Blob store's settings in Vercel | Audio upload and prune |
| `VERCEL_TOKEN` | Vercel, Account settings, Tokens | Deploys |
| `GITHUB_DISPATCH_TOKEN` | GitHub, Fine-grained personal access tokens | Generate button |
| `GENERATE_PASSPHRASE_HASH` | `npm run passphrase` | Generate button |

Track expiry here. Fill the dates when you create each token and set a calendar reminder two weeks before.

| Token | Created | Expires | Renew by |
| --- | --- | --- | --- |
| `GITHUB_DISPATCH_TOKEN` | | | |
| `VERCEL_TOKEN` | | | |

When `GITHUB_DISPATCH_TOKEN` expires, the Generate button stops working and the status endpoint shows a clear message. Scheduled runs are unaffected, because `run.yml` uses the built-in workflow token. When `VERCEL_TOKEN` expires, the deploy step fails and the site stops updating.

---

## 7. Prune audio

Vercel Hobby holds 1 GB of Blob storage. A four-minute digest is about 2 MB at 64 kbps and about 4 MB at 128 kbps, so audio older than about 120 days is deleted.

- Pruning runs on every deploy: `deploy.yml` calls `dispatch publish --prune`.
- To prune now, run `gh workflow run deploy.yml -R somesh-ks/dispatch`.
- A pruned digest keeps its text and timeline. The site shows no player for it.
- Check usage in the Vercel dashboard under Storage. If usage nears 1 GB, lower the audio bitrate or shorten retention.

---

## 8. Troubleshooting

### 8.1 A digest did not arrive

1. Run `npm run dispatch -- status`. A regular digest is due every second day, so a quiet day can be correct (`gated`).
2. Check the last runs: `gh run list -R somesh-ks/dispatch --workflow run.yml --limit 5`.
3. No run at 07:13: GitHub can delay or drop scheduled runs. The next daily trigger widens the window, so nothing is lost. Start an on-demand run to get it now.
4. Run exists but outcome is `nothing`: fewer than three items cleared the bar. Normal on a quiet day.
5. Outcome is `failed`: read the run (section 5).
6. Workflow disabled: `gh workflow list -R somesh-ks/dispatch --all`. Enable it with `gh workflow enable run.yml -R somesh-ks/dispatch`.

### 8.2 Audio is missing

1. The page says "Audio is still being prepared": the text digest published but speech failed. Run `gh workflow run deploy.yml -R somesh-ks/dispatch`. `dispatch publish` retries audio for every digest inside the retention window that lacks it.
2. Still failing: check `state/usage.json`. The engine stops at 90 percent of the monthly Speechify allowance. Wait for the next month or raise the plan.
3. A recent digest points at a deleted Blob file: delete its `.audio.json`, set `audio: null` in the digest frontmatter, commit, then run `deploy.yml`.
4. An old digest has no player: its audio was pruned. That is expected (section 7).
5. Playback starts but seeking fails on iPhone only: this is the Blob Range risk in [build-plan.md](build-plan.md) Section 14. Record the iOS version and report it.

### 8.3 The Nebius model id changed

Nebius retires and renames models. Symptoms: the `write` step fails with a model-not-found error, or `dispatch doctor` reports a missing model id.

1. Run `npm run dispatch -- doctor`. It checks `DISPATCH_MODEL` and `DISPATCH_FALLBACK_MODEL` against the live model list.
2. The client fails over to the fallback id on model-not-found, so a run may still succeed. Fix the id anyway.
3. Pick the replacement from the Nebius model list. Set `DISPATCH_MODEL` (and the fallback) in `.env`.
4. Run `npm run secrets:push`. These are sent as GitHub Actions variables.
5. Rerun the writer bake-off on the golden set (`npm run eval`) before trusting the new model. A different model writes differently.

### 8.4 Jev is unavailable

1. A 429 or 529 means rate limit or an outage. The engine retries with backoff, then the Nebius fallback judge answers. The run log says which judge answered.
2. A 401 means the key was revoked or expired. Rotate `TYPESAFE_API_KEY` (section 6).
3. With `TYPESAFE_API_KEY` unset, the Nebius judge answers by design.
4. If Jev stays down for days, check the TypeSafe console for status, balance and version retirements. The fallback judge is less calibrated, so scores shift. Revalidate thresholds on the golden set before trusting them again.

### 8.5 The site did not update

1. Open the `deploy.yml` run and read the failing step.
2. Vercel auth error: the token expired or the secret is wrong. Rotate `VERCEL_TOKEN`.
3. A path error that repeats `apps/web` twice: the project's Root Directory setting is not empty. Clear it in the Vercel project settings.
4. `news.someshks.work` shows an old page but the deploy succeeded: wait a minute, then hard refresh. Check that the DNS record is DNS only. A proxied record (orange cloud) breaks certificate issuance.

### 8.6 The Generate button fails

| Message | Cause | Fix |
| --- | --- | --- |
| Wrong passphrase | Typo, or the hash does not match | Retry. If forgotten, run `npm run passphrase`, `npm run secrets:push`, then redeploy |
| Cooldown with a time | One run in 6 hours, or three in 24 hours | Wait. Runs started by `gh` or the skills count too |
| The button cannot start a run | The dispatch token expired or lost access | Rotate `GITHUB_DISPATCH_TOKEN` (section 6) |

---

## 9. Add a source and teach the taste model

### 9.1 Add a source

1. Add a row to `config/sources.md` under the right category.
2. Run `npm run dispatch -- sources discover`. It finds the feed and updates `config/sources.json`. A site with no feed becomes a Firecrawl scrape source.
3. Run `npm run dispatch -- sources check` and confirm the new source answers.
4. Commit both files as `feat(sources): add <name>` and push.

### 9.2 Teach with `/learn`

1. In the repository, run `/learn` with one sentence, for example "more shaders, less VC funding". From any other folder, ask `sk-dispatch` to learn.
2. Read the diff. The change is bounded: at most 0.05 per weight and 0.15 in total per call.
3. Accept it. The skill applies it through `dispatch learn --apply`, commits as `chore(prefs): ...` and pushes.
4. The next run uses the new weights. Cached judgments are re-scored with no new calls.

Do not edit `config/preferences.json` by hand. To undo, revert the `chore(prefs)` commit.

---

## 10. Restore from git

Git holds the code, config, digests, state and docs. It does not hold secrets (`.env`, GitHub secrets, Vercel variables) or audio (Vercel Blob).

| Situation | Steps |
| --- | --- |
| A bad digest | Run `git revert <sha>` on its `chore(digest)` commit and push. The revert also restores `state/`, so the next run covers the same window again |
| A bad edit to one file | `git checkout <sha> -- <path>`, commit, push |
| Laptop lost | Clone `https://github.com/somesh-ks/dispatch.git`, run `npm ci`, recreate `.env` from the services (reissue keys if needed), run `npm run secrets:push` only if the stores lost their values |
| GitHub repository lost | Any clone is a full copy. Create a new private repository, push, then repeat section 1.8 and update `GITHUB_REPOSITORY` |
| Audio lost | Within the retention window, remove the digest's `.audio.json`, set `audio: null`, commit, run `deploy.yml`. It regenerates at a cost in Speechify characters |
| Vercel project lost | Repeat sections 1.2 to 1.4 and 1.8, then run `deploy.yml` |
