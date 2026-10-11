# Dispatch: decision log

Each entry records what was decided, why, and what was rejected. Add new entries at the end with the next number. Do not rewrite an old entry: if a decision changes, add a new entry that supersedes it and set the old status to "Superseded by Dn".

The plan that implements these decisions is [build-plan.md](build-plan.md). The vision is [vision.md](vision.md).

D1 to D9 date from plan v2 (2026-10-05). D10 to D25 date from 2026-10-06. Reasons are the plan's working rationale, written by the docs owner; correct any the owner would state differently.

## Index

| ID | Decision | Status |
| :--- | :--- | :--- |
| D1 | Engine runs on GitHub Actions | active |
| D2 | The repository lives in this folder | active |
| D3 | Judge is TypeSafe Jev, writer is a cheap Nebius model chosen by a bake-off | active |
| D4 | Astro with React islands, Base UI and hand-written token CSS | active |
| D5 | One MP3 per digest with word marks, from Speechify | superseded by D33 for new narration |
| D6 | Daily cron with a calendar-date gate, plus a Sunday weekly pass | active; the trigger is Vercel Cron since D61, the date gate stays; the weekly day has no briefing since D65 |
| D7 | Podcast feed deferred | active |
| D8 | "Thought of the Day" cut | active |
| D9 | Repository `somesh-ks/knowledge-hub`, private | active |
| D10 | Hosting on Vercel | partly superseded by D25 |
| D11 | Notification is the commit only | active |
| D12 | Voice limits confirmed | superseded by D34 |
| D13 | Accounts exist | active |
| D14 | Docs and config filenames are lowercase kebab-case | active |
| D15 | Persisted keys are snake_case and code follows them | active |
| D16 | Personal skill `sk-dispatch`, built separately | active |
| D17 | UI and sound design live in `docs/design/` | active |
| D18 | UI sounds are procedural Web Audio from `@dispatch/sound` | active |
| D19 | TypeScript 6 pinned repository-wide | active |
| D20 | One preferences key for theme and settings | active |
| D21 | Source health lives in state | active |
| D22 | `deploy.yml` owns the deploy | superseded by D25 |
| D23 | The engine tolerates audio failure | active |
| D24 | The writer model is picked from the live Nebius list | active |
| D25 | The Vercel GitHub integration deploys the site | active |
| D26 | Audio uploads use Vercel Blob OIDC credentials | active |
| D27 | Owner and Dependabot pull requests merge automatically | active |
| D28 | The audio job runs the Vercel CLI outside the checkout, and its failure is not a failed run | active |
| D29 | Narration is hosted: a spoken version per story and a code-built host frame | active |
| D30 | The reader is called Singularity; identifiers keep `dispatch` | active |
| D31 | The visual language follows Google Podcasts and YouTube Music | active |
| D32 | The player is one always-mounted surface, without Base UI Drawer | active |
| D33 | Narration is made on Play, story by story | active |
| D34 | Stories are told in four beats; the why line is no longer written | active |
| D35 | A Tech releases section, ranked by launch scale, with its own allowance | active |
| D36 | Topics and sources are data the owner edits from the app | active |
| D37 | Custom podcast episodes live in `Podcasts/` and are built by a workflow | active |
| D38 | Subagents are few, narrow, enforced and capped | active |
| D39 | Five topics, Top picks always included, General and Customized audiences | active; Create's topics are one list since D67 |
| D40 | Trending is ranked by coverage; discovery only suggests | active |
| D41 | The passphrase step is switched off, with its code kept | active |
| D42 | One Jev request per item, and a per-run Firecrawl ceiling | active |
| D43 | General episodes are built from general-news feeds, ranked by coverage | active; general ids mix with briefing ids since D67, and their feeds are judged sources since D66 |
| D44 | An episode can be deleted, or regenerated with the listener's feedback | active |
| D45 | The briefing's hour, cadence and topics are set in Settings | active; `RUN_CRON` is the fallback trigger since D61 |
| D46 | The writer's provider and model are chosen in Settings | active |
| D47 | A move between pages is answered from a saved copy and swapped at once | active |
| D48 | One shader: a light in the cover's colours behind the header, on a GPU only | active |
| D49 | One Podcast settings page: Daily, Weekly and Custom profiles, a shared writer vendor and model, topics and sources clubbed | page layout superseded by D51; the 0 to 5 score by D55 |
| D50 | The open player: a speed slider, Chapters or a Speechify-style transcript, word marks stored beside each segment | active |
| D51 | Settings is two levels and saves itself; every select opens one drawn list | active; the Custom page superseded by D56 |
| D52 | On a phone the Create button floats only on Today and the Library, extended until you scroll | superseded by D60: Create floats on the Library alone |
| D53 | First-load JavaScript budget 110 KB, kept as low as the code allows | active |
| D54 | Form fields carry a 3:1 outline; in the player only Play is in full ink | active |
| D55 | A source's score is out of 3: health, quality and trust, combined so a weak part cannot be bought back | active |
| D56 | One panel adds a topic or a source and edits a source; Settings has no Custom page | active |
| D57 | A topic's page edits its details and adds the sources that suit it; topics are listed by name | active; shipped topics take a new name, and app topics new wording, since D64 |
| D58 | The Model page offers six top Nebius writers by name, live list or not | active |
| D59 | On a phone, Play takes the floating button's place on an episode and an older briefing | active; Today floats Play too since D60 |
| D60 | On a phone Create floats on the Library alone; every page with audio floats Play, Today included | active |
| D61 | Vercel Cron starts the scheduled briefing in its hour; GitHub's schedule is the fallback | active |
| D62 | Daily and Weekly each choose their topics; voice samples play through the site | active; topics are left out per topic since D63 |
| D63 | Daily and Weekly leave out topics, one chip per topic, stored as the topics left out | active |
| D64 | Every topic can be renamed; what counts edits wherever the judge reads it | active |
| D65 | The weekly podcast takes its day; the daily cadence counts from it | active |
| D67 | Create shows one list of topic chips; the audience presets them; an episode can mix briefing and general topics | active |
| D68 | An episode opens with a rundown, deep-dives its lead stories, gives the rest as nuggets and closes short | active |

---

## D1: Engine runs on GitHub Actions

- Date: 2026-10-05
- Status: Confirmed. Replaces the earlier choice of a Claude Code cloud routine.
- Decision: The curation engine runs as a CLI (`dispatch run`) on GitHub Actions. Every other trigger (site button, skills, laptop) is a thin caller of the same CLI.
- Reason: Routines push to `claude/` branches by default, start with a restricted network allowlist, and expose an experimental trigger limited to 30 fires per hour. Actions is stable, has full network access and its own secret store. Model and judgment spend stays well under 1 USD a month, so the host choice is not a cost question.
- Rejected: A Claude Code cloud routine as the engine (limits above, and an agent with tools reading untrusted web text is the worst case for prompt injection). A laptop-only cron (misses runs when the machine is off). Claude API for curation (Nebius and Jev were chosen instead).

## D2: The repository lives in this folder

- Date: 2026-10-05
- Status: Confirmed
- Decision: The repository root is `C:\Users\soke\Desktop\Agents\2. Hobbies\1. Projects\2. News outlet`.
- Reason: It already holds the planning files. The base path is 66 characters, and deep `node_modules` paths can approach the 260-character Windows limit, so enabling long paths is optional hardening that needs the owner's approval.
- Rejected: A shorter path elsewhere on disk.

## D3: Judge is TypeSafe Jev, writer is a cheap Nebius model chosen by a bake-off

- Date: 2026-10-05
- Status: The Jev judge stands. The writer-model half is superseded by D24.
- Decision: Typed judgments (category, craft depth, hype, sponsorship and funding flags, grounding checks) come from TypeSafe Jev. Summaries come from the cheapest Nebius model that clears the quality bar on a golden set, starting with Qwen3-32B (history: see D24). A Nebius judge stays wired as the fallback.
- Reason: Jev returns calibrated probabilities, so near-ties are handled honestly and weights can change without new calls. Writing cost is negligible at this volume, so the writer is chosen on quality and reliability with price as the tie-breaker.
- Rejected: One frontier model for both roles (more cost, no probabilities). A Nebius-only judge as the default (JSON answers without calibrated probabilities).
- Revisit if: Jev is repriced, rate-limited or withdrawn; revalidate quarterly.

## D4: Astro with React islands, Base UI and hand-written token CSS

- Date: 2026-10-05
- Status: Decided. Rationale in build-plan Section 8.1.
- Decision: The web app is Astro with React islands, Base UI for accessible unstyled parts, and CSS custom properties compiled from design tokens.
- Reason: Reading is HTML first with near-zero JavaScript. The audio element lives in a module, so it survives navigation. Base UI keeps the look ours.
- Rejected: A Vite React SPA with a router (heavier for a reading app). SvelteKit (leaves the React and Base UI ecosystem). Tailwind and shadcn (a templated look; the shadcn and Radix drawer rests on Vaul, which is unmaintained).

## D5: One MP3 per digest with word marks, from Speechify

- Date: 2026-10-05
- Status: Decided. Free-tier availability of marks is confirmed in the spike.
- Decision: Each digest has one MP3 made with Speechify `simba-3.2` and its word-level marks, plus a timeline file with an item start time for each item.
- Reason: The lock screen shows one track with a working scrubber, and every item becomes a seek target.
- Rejected: One audio file per section (breaks the lock-screen scrubber). A timeline estimated from character share as the default (kept only as the fallback).

## D6: Daily cron with a calendar-date gate, plus a Sunday weekly pass

- Date: 2026-10-05
- Status: Decided
- Decision: The schedule fires daily at 07:13 Europe/Stockholm. A regular digest is due when the Stockholm calendar date is two or more days after the last regular digest. On Sundays a weekly pass runs after the regular one.
- Reason: A delayed cron still lands on its own date, so drift never costs a cycle. 07:13 avoids the delays GitHub applies at the top of the hour.
- Rejected: Day-of-month `*/2` (resets at month end). A 07:00 cron (top-of-hour delays).

## D7: Podcast feed deferred

- Date: 2026-10-05
- Status: Not now
- Decision: No private podcast feed (`/feed.xml`) in v1.
- Reason: The web player is the product. A feed adds a delivery surface to maintain before the web path has been tested.
- Rejected: Shipping the feed at launch.
- Revisit if: iOS lock-screen playback proves flaky in the spike. Podcast apps are the most reliable background path on iOS, so the feed is the first fallback.

## D8: "Thought of the Day" cut

- Date: 2026-10-05
- Status: Cut
- Decision: The digest has no "Taste & Thought of the Day" section.
- Reason: It breaks the brevity bar. Everything in a digest is an item the reader can use.
- Rejected: Keeping it as a short closing line.

## D9: Repository `somesh-ks/knowledge-hub`, private

- Date: 2026-10-05
- Status: Confirmed
- Decision: The GitHub repository is `somesh-ks/knowledge-hub` and is private.
- Reason: The repo holds the taste model and summaries of third-party content, and the site is for one reader. The Free plan's 2,000 private-repo Actions minutes cover the expected use of about 120 a month.
- Rejected: A public repository. Private repos lack secret-scanning push protection on the Free plan, so gitleaks runs as a pre-commit hook and in CI.

## D10: Hosting on Vercel

- Date: 2026-10-06
- Status: Confirmed. Replaces the Cloudflare Workers static assets, R2, KV and Turnstile design. The CLI-deploy part (second bullet and the Git integration reasoning) is superseded by D25.
- Decision:
  - The site is static on Vercel. Only `/api/*` runs on the server, as Vercel Functions through `@astrojs/vercel`.
  - GitHub Actions deploys with `vercel pull`, `vercel build --prod` and `vercel deploy --prebuilt --prod`, run from `apps/web` with `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. The Vercel Git integration is not used.
  - Audio lives in a public Vercel Blob store, key `audio/<digest id>.mp3`. Hobby storage is 1 GB, so `dispatch publish --prune` deletes audio older than about 120 days.
  - `news.someshks.work` stays on Cloudflare DNS as one CNAME record, DNS only, pointing at the target Vercel shows. Vercel issues the certificate.
  - The Generate button is a Vercel Function with a scrypt passphrase check and a stateless cooldown and cap read from the GitHub API (one on-demand run per 6 hours, three per 24 hours). No KV and no Turnstile in v1.
- Reason: One platform covers static hosting, functions and public audio storage, so the Worker, R2 bucket, KV namespace and Turnstile widget drop out. The Git integration is avoided because pushes made with `GITHUB_TOKEN` do not reliably trigger it and Hobby blocks deploys whose commit author is not the account owner, which every bot commit would be. The reason for leaving Cloudflare hosting was not recorded by the owner; the points above are the technical case.
- Rejected: Staying on Cloudflare (Workers static assets, R2, KV, Turnstile). The Vercel Git integration for deploys. KV or an external store for Generate counters, and a Turnstile bot check (more accounts and moving parts; the runs list on GitHub is enough for v1).
- Residual risk: No per-IP failure counting and no bot check on `/api/generate`. The scrypt cost, a long passphrase, the unlisted URL and the run cap are the mitigations (build-plan Section 11).
- Revisit if: The Generate endpoint sees abuse, Blob Range playback fails on iOS, or Hobby limits bind.

## D11: Notification is the commit only

- Date: 2026-10-06
- Status: Confirmed
- Decision: A new digest is announced by its `chore(digest): YYYY-MM-DD` commit. There is no email, Gmail draft or push notification in v1.
- Reason: GitHub already emails the workflow owner when a scheduled run fails, and the owner reads the site daily. A Gmail draft adds a connector and permissions for little gain.
- Rejected: A Gmail draft per digest. Web push (listed as a later feature).

## D12: Voice limits confirmed

- Date: 2026-10-06
- Status: Confirmed as specified in build-plan Section 7.6
- Decision: Headline 12 words, summary 35 words and two sentences at most, why 18 words and one sentence, 8 to 12 items in a regular digest, floor 3, cap 12 (weekly 18).
- Reason: These hold the brevity bar: about two minutes to read and four to listen.
- Rejected: Looser limits, which let digests grow past the time budget.

## D13: Accounts exist

- Date: 2026-10-06
- Status: Confirmed
- Decision: Accounts at Nebius, TypeSafe, Exa, Firecrawl and Speechify already exist. Keys are stored only in the gitignored `.env`, GitHub Actions and Vercel, never in the repo or in chat.
- Reason: Phase 0 needed them before any key could be stored or any live call made.
- Rejected: Creating accounts during the spike.

## D14: Docs and config filenames are lowercase kebab-case

- Date: 2026-10-06
- Status: Confirmed
- Decision: Files under `docs/` and `config/` use lowercase kebab-case, for example `build-plan.md`, `sources.md` and `reader-prototype.html`.
- Reason: Names without spaces or capitals work in shell commands and URLs, and stay stable on case-sensitive CI runners.
- Rejected: Title Case names with spaces (the original planning files, such as "Build Plan.md").

## D15: Persisted keys are snake_case and code follows them

- Date: 2026-10-06
- Status: Confirmed
- Decision: Keys in frontmatter, JSON and state files are snake_case, and the TypeScript types in `packages/core` use the same names. Enum values keep their own spelling, such as `on-demand` and `ui-craft`.
- Reason: One spelling from file to type removes a mapping layer and a class of bugs.
- Rejected: camelCase in code with a translation layer at the file boundary.

## D16: Personal skill `sk-dispatch`, built separately

- Date: 2026-10-06
- Status: Confirmed
- Decision: A personal-scope skill, `sk-dispatch`, is built in the owner's `~/.agents/skills` with the skill creator (five-part layout, evals, Antigravity workflow). It works from any directory: it locates a checkout, or falls back to `gh` against `somesh-ks/knowledge-hub`. Actions: status, run (remote dispatch with watch), read the latest digest, learn, open the site. The in-repo skills `digest` and `learn` stay under `.claude/skills` for work inside the repo.
- Reason: Personal skills do not load in cloud sessions, and in-repo skills do not load outside the repo. Two layers cover both.
- Rejected: Exposing the in-repo skills through a personal-scope junction (the v2 plan). One in-repo skill only.

## D17: UI and sound design live in `docs/design/`

- Date: 2026-10-06
- Status: Confirmed
- Decision: The design lead specifies the interface in `docs/design/design-spec.md` and sound in `docs/design/sound-design.md`. The build plan keeps the product requirements and points to them.
- Reason: One canonical home for visual and interaction detail lets design and engineering proceed in parallel and keeps the build plan short.
- Rejected: Keeping the full UI specification inside the build plan.

## D18: UI sounds are procedural Web Audio from `@dispatch/sound`

- Date: 2026-10-06
- Status: Confirmed
- Decision: UI sounds are synthesized in the browser by the `@dispatch/sound` package. They are optional, restrained, off while narration plays unless the sound design says otherwise, respect the iOS silent switch, and are never used for high-frequency actions.
- Reason: Synthesis needs no sample files, adds almost no weight to the first load and can be tuned in code.
- Rejected: Sampled audio files (weight and licensing). No UI sounds at all.
- Revisit if: The spike shows Web Audio misbehaving on iOS with narration playing.

## D19: TypeScript 6 pinned repository-wide

- Date: 2026-10-06
- Status: Confirmed
- Decision: The root and `apps/web` pin `typescript` to `~6.0.3`, so the whole repository typechecks with one compiler.
- Reason: The Astro language tooling behind `astro check` breaks under TypeScript 7, and two versions in one workspace would check the engine and the site against different compilers.
- Rejected: TypeScript 7 with `astro check` dropped (loses type checks in templates). A different version per workspace.
- Revisit if: The Astro tooling supports TypeScript 7.

## D20: One preferences key for theme and settings

- Date: 2026-10-06
- Status: Confirmed
- Decision: Theme, interface sounds, volume and playback speed are one JSON object under the `localStorage` key `dispatch:preferences`. The inline theme script that runs before first paint reads the same key.
- Reason: One key means the pre-paint script and the settings store cannot drift apart.
- Rejected: A separate key for the theme and another for the other settings (two sources of truth for what the pre-paint script reads). A cookie (the site is static and nothing on the server reads it).

## D21: Source health lives in state

- Date: 2026-10-06
- Status: Confirmed
- Decision: Per-source consecutive failures and last success are stored in `state/source-health.json` and overlaid onto the registry when it is loaded. `config/sources.json` holds only hand-edited configuration.
- Reason: The write guard lets `run` change only `Digests/` and `state/`, and a run must not rewrite configuration the owner edits by hand.
- Rejected: Failure counters inside `config/sources.json` (the earlier design), which the guard would refuse and which would mix automated churn into reviewed configuration.

## D22: `deploy.yml` owns the deploy

- Date: 2026-10-06
- Status: Superseded by D25. As-built detail of D10, which held the commands and the reason for leaving the Git integration off.
- Decision: `deploy.yml` is a reusable workflow with its own concurrency group, `deploy`. It checks out `main`, not the caller's commit, and passes `VERCEL_TOKEN` only to the Vercel pull and deploy steps, never to the build.
- Reason: A called workflow that shares its caller's concurrency group is cancelled. The caller's commit predates the bot commit. The build runs repository code and dependencies, so it gets no token.
- Rejected: Sharing `run.yml`'s group. A token at job level. Deploying the caller's commit.

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

## D25: The Vercel GitHub integration deploys the site

- Date: 2026-10-06
- Status: Confirmed, unproven until the first live deploy. Supersedes D22 and the CLI-deploy part of D10.
- Decision:
  - The Vercel project `knowledge-hub` is connected to `somesh-ks/knowledge-hub`, production branch `main`. Vercel builds on every push to `main`. Root Directory is `apps/web`, with "Include source files outside of the Root Directory" on (the default).
  - `apps/web/vercel.json` sets `installCommand` to `cd ../.. && npm ci --ignore-scripts`, `buildCommand` to `npm run build`, and an `ignoreCommand` that skips the build when a push touches nothing the site reads. Only `Digests`, `apps/web`, `packages`, `tokens`, `scripts` and the root package files matter; pushes to `state`, `config`, docs and `.github` are skipped.
  - Vercel Hobby deploys only a commit whose author is the Hobby team owner. The engine therefore commits as the owner, from the GitHub Actions variables `DISPATCH_GIT_NAME` (Somesh Kesarla Suresh) and `DISPATCH_GIT_EMAIL` (`26426782+somesh-ks@users.noreply.github.com`, the GitHub noreply address, which Vercel matches to the GitHub login). When both are unset the engine falls back to the old `dispatch-bot` identity, which Hobby blocks. Source: https://vercel.com/docs/deployments/troubleshoot-project-collaboration
  - `deploy.yml` is removed. `.github/workflows/audio.yml` replaces it: reusable (`workflow_call`) and manual (`workflow_dispatch`), with its own concurrency group, `audio`. It checks out `main`, installs, then one `Audio` step runs `dispatch publish --prune 120`, which uploads MP3s to Vercel Blob and commits and pushes the timeline metadata as the owner identity. That push triggers a second Vercel deploy that carries the audio. `run.yml` calls `audio.yml` when the Commit step's `deploy` output is true; the key keeps its name and now means "audio follow-up needed".
  - `ci.yml` has no deploy job. It still runs `changes`, `check` and `secrets` (gitleaks).
  - `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are no longer needed anywhere.
- Reason: Commits made with `GITHUB_TOKEN` are the reason D10 avoided the Git integration, but the integration reacts to the push and the commit author, not to the token. Committing as the owner satisfies Hobby and removes the CLI token, the project link and the pull, build and deploy steps. The build now runs inside Vercel, not in a workflow that held a deploy token.
- Consequence: A published digest deploys twice: once for the text, right after the Commit step, and once for the audio. The text is readable first, and the player shows no audio until the second deploy.
- Rejected: Keeping the CLI deploy (needs a token, an org id and a project id in GitHub, and a separate deploy workflow). A paid Vercel plan, which would accept bot authors. Deploy hooks (a secret URL to guard and no commit-level skip).
- Residual risk: Unproven until the first live deploy: the Vercel build of the `apps/web` workspace through the Git integration with this `installCommand`; the `ignoreCommand` on a shallow clone; Hobby accepting the owner-identity commit; two deploys per run. The GitHub login connected to Vercel must match the committer, so it must belong to the owner of the Hobby team.
- Revisit if: The first live deploy fails or skips, Hobby stops matching the noreply address, or the double deploy hits a Hobby limit.

## D26: Audio uploads use Vercel Blob OIDC credentials

- Decision: The Audio step links the project with `VERCEL_TOKEN`, runs `vercel env pull`, and the engine uploads with `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID`. `BLOB_READ_WRITE_TOKEN` still wins when set.
- Why: Vercel marks the long-lived Blob token sensitive and never shows it again; new stores default to OIDC.
- Rejected: Cloudflare R2 (more code and a new CSP rule); an upload route on the site (more code, one more secret).
- Status: unverified until the first audio run.

## D27: Owner and Dependabot pull requests merge automatically

- Decision: `automerge.yml` squash-merges a pull request when `ci` passes on its current head and the author is the owner or Dependabot. Dependabot skips major versions.
- Why: branch protection would block the digest commits that push to `main`, so the merge rule lives in a workflow instead.
- Limit: the workflow token cannot merge changes to `.github/workflows`; those merge by hand.

## D28: The audio job runs the Vercel CLI outside the checkout, and its failure is not a failed run

- Decision: `audio.yml` runs `vercel link` and `vercel env pull` in a scratch directory, takes only `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID` from the pulled file, and fails loudly when either is missing. `loadEnv` treats the `[SENSITIVE]` placeholder as unset. The Generate status endpoint reads the run record when the only failing step is the nested `Audio` step. The site build also runs when `state/last-run.json` changes.
- Why: the CLI edits `.gitignore`, which the write guard refuses; sourcing the whole pulled file lets it override secrets and mangles values with a dollar sign; the digest is already live when narration fails, so reporting "failed" invites a wasted retry; the site reads `last-run.json` for the "nothing cleared the bar" banner. This refines D25, which skipped every `state/` push.
- Rejected: `continue-on-error` on the audio job (not allowed on a reusable-workflow call and it would hide failures); exiting non-zero from `publish` on missing credentials (D23 and its tests keep narration non-fatal).
- Status: unverified until the first audio run succeeds.

## D29: Narration is hosted: a spoken version per story and a code-built host frame

- Decision: The writer returns an optional `spoken` telling (3 to 5 sentences, 40 to 95 words, 700 characters at most) beside the summary, stored on the digest item and never shown on the page. A digest item whose `spoken` fails lint, or states a number the headline and summary do not, loses `spoken` and narration reads the headline and summary as before. Around the stories, `audio/hostFrame.ts` adds an opening that names the product, the day and the count, a bridge into each later section, light connectives between stories and a sign-off (the `outro` segment). All of it is deterministic, chosen by hashing the digest and item ids, and none of it needs a model call, so old briefings gain it too. Headlines are asked to read like a person wrote them; a changelog shape ("X 2.0 released with Y") only warns.
- Why: the briefing is listened to, and a headline read as a title followed by a summary sounded transactional. Telling the story aloud and framing it fixes that without lowering the factual bar, because the summary stays the grounded text.
- Rejected: grounding the spoken text with Jev (more spend for a retelling of text already grounded; a number check is cheap); a model-written host frame (cost, and the same phrases would drift between runs); a clock-based greeting (a digest is written once and heard at any hour).
- Cost: the narration text of every briefing changes, so audio already stored for the old text is not reused. The sign-off adds one segment, so a story-by-story narration of 18 stories is 21 advanced Blob operations.
- Status: unverified against live Speechify.

## D30: The reader is called Singularity; identifiers keep `dispatch`

- Date: 2026-10-08
- Decision: Every string a reader sees or hears says Singularity: titles, the manifest, the wordmark on covers, the narration's opening line. The repository, the CLI, the `@dispatch/*` packages, `DISPATCH_*` variables, storage keys, cache names and element ids keep `dispatch`.
- Why: renaming identifiers would wipe saved preferences and playback positions and touch every import for no reader benefit.
- Rejected: a full rename.

## D31: The visual language follows Google Podcasts and YouTube Music

- Date: 2026-10-08
- Decision: Flat surfaces, hairline rows, one blue accent, Google Sans Flex in two weights, Phosphor icons from one generated source (`tokens/glyphs.json`), an outlined play chip as the one pill. Navigation is Today, Library, Create, Settings: a bottom bar below 64rem, a side column from 64rem. The Library is a cover grid with search, sort and filter. Type rule from the owner: no small text pressed against larger text, at most two type steps per block, a quiet line goes under its title with space, never above it. This updates D4 and D17; `docs/design/design-spec.md` describes the old look and is out of date.
- Why: the owner named the reference and asked for a real podcast app. A pinned reference beats a new invention.
- Rejected: Material Symbols (the owner asked for Phosphor); a page called Archive (no podcast app has one); reading time and per-section clocks in the reader (small text beside headings).
- Cost: the first-load JavaScript budget moved from 100 to 102 KB when the bottom bar became a full transport.

## D32: The player is one always-mounted surface, without Base UI Drawer

- Date: 2026-10-08
- Decision: A dock, a stage and a page live in one persisted island with no portal. One progress value drives the travel in CSS; a state machine owns open, drag and close; `inert` gives modal scope. Below 40rem the dock rides the page; from 40rem the dock stays put and the page rises behind it. The dock carries seek, a clock and volume on wide screens.
- Why: the old sheet lived in a body-level portal that a client-side navigation destroyed while the controller still thought it was open, which is what "stuck" was. Drawer cannot model a bar that is non-modal at rest and modal when open.
- Rejected: native `dialog` (cannot go from non-modal to modal without closing); a view transition for the cover (not interruptible).
- Status: Chromium verified by its suite; two mouse-drag tests failed on desktop and WebKit is unverified.

## D33: Narration is made on Play, story by story

- Date: 2026-10-08
- Decision: A briefing has no audio until someone plays it. Play asks `GET /api/narrate` for the briefing's segments (an intro, one per story, a sign-off), which costs no store operation because each segment's address is computed. The player tries each address and `POST`s only for a file that is missing, which needs the passphrase. The client presents the files as one track on a fixed timeline (`narration/trackAudio.ts`) and makes the next few ahead of the playhead. A briefing is charged whole to the monthly budget the first time any part of it is narrated. This supersedes D5 for new narration; the whole-briefing path and `audio.yml` remain.
- Why: a whole briefing took too long to synthesize inside a function for the first Play to be audible, and narrating every run spent characters on briefings nobody played. A byte stream to the browser would have lost scrubbing, story jumps and resume.
- Rejected: streaming audio to the browser; a manifest file (read-modify-write races between segments); listing the store on lookup (an anonymous caller could exhaust the Hobby Blob quota of 2,000 advanced operations a month).
- Open: a reader without the passphrase cannot make audio. Decide whether the engine should narrate each new briefing once, so the Play path never dead-ends for a wider audience.
- Status: unverified against live Speechify and Blob.

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

## D37: Custom podcast episodes live in `Podcasts/` and are built by a workflow

- Date: 2026-10-08
- Decision: The Create page posts a request (topics, length of 3 to 15 minutes, format: readout, discussion or headlines, look-back window, tone) to `/api/podcast`, which dispatches `podcast.yml`. `dispatch podcast` selects stories from published briefings in the window, has the writer produce a script of turns, checks every number against the stories, and commits `Podcasts/YYYY/MM/<id>.md`. Episodes appear in the Library and play through D33, one segment per turn, with a second voice for the second host (`SPEECHIFY_VOICE_ID_B`).
- Why: a function is too short-lived to write a script, and reusing judged, summarized stories makes an episode cost one writer call.
- Rejected: storing episodes as digests (a digest needs three items and a date id); a fresh fetch and judge per episode in the first version.
- Limits: 2 episodes a day, a 30 minute cooldown, 15,000 characters per episode.
- Status: unverified live.

## D38: Subagents are few, narrow, enforced and capped

- Date: 2026-10-08
- Decision: Ten agents, each with one job, a model tier, `effort`, `maxTurns` and (except `general-purpose`) a tool allowlist in its frontmatter. User level (`~/.claude/agents/`): `Explore` (overrides the built-in, haiku), `general-purpose` (overrides the built-in, sonnet, core tools and web only, no MCP because the full MCP schemas cost about 289k tokens per call; 118 of 214 past calls used it on the main model; the `claude` agent covers MCP tasks), `scout` retired, `planner`, `reviewer`, `ui-critic`, `motion-reviewer`, `researcher`, `deep`. Project level (`.claude/agents/`): `dispatch-verify` (haiku; typecheck, tests, lint, build, 102 KB budget) and `dispatch-worker` (sonnet; one workstream in a worktree, never merges). Read-only agents run Bash through `~/.claude/hooks/readonly-bash.mjs`. No agent preloads a skill and no plugin is enabled for them. Subagent cache TTL is 1 hour; at most 4 concurrent agents, depth 1. Effort is chosen once at first launch (rule in the global CLAUDE.md). `/close-session` is a main-thread skill because a subagent cannot see the conversation.
- Why: delegation costs about 4x chat tokens and multi-agent about 15x, so an agent earns its place only by reading a lot and returning a little. Prose "read-only" did not stop `deep` and `motion-reviewer` inheriting every tool.
- Rejected: preloading design skills into `ui-critic` (full text on every run); enabling `motion-design` for `motion-reviewer`; agent teams; a docs-keeper agent.
- Status: active. Hook, tool allowlists, overrides and `dispatch-verify` verified in a fresh session; the rest is listed in state.md.

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

## D41: The passphrase step is switched off, with its code kept

- Date: 2026-10-08
- Decision: `PASSPHRASE_REQUIRED` in `apps/web/src/lib/access.ts` is false. The four routes hand their handlers a check that lets a request through, Play narrates without the sheet, and Create, Generate and the Topics and Sources save show no prompt. Same-origin checks, cooldowns, daily caps and the monthly narration budget stay enforced. Setting the constant to true restores every prompt and check. Tests of the prompts are kept and skipped while it is off.
- Why: the owner asked for it ("remove passphrase for now, but we can have the code for future") after a failure that was blamed on the passphrase and was in fact the site's GitHub token lacking access to the repository.
- Cost: anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps. The owner accepted this.
- Rejected: deleting the passphrase code; unlocking one device at a time (offered, not chosen).

## D44: An episode can be deleted, or regenerated with the listener's feedback

- Date: 2026-10-08
- Decision: `podcast.yml` still passes one JSON input to `dispatch podcast --request`; it is now a new episode (no `action`), `{"action":"delete","id"}` or `{"action":"regenerate","id","feedback"}` (`PodcastCommand` in core; feedback 1 to 500 characters, control characters become spaces). Delete removes `Podcasts/YYYY/MM/<id>.md` and commits `chore(podcast): remove <id>` through the existing `podcast` allowlist (`Podcasts/` only, unchanged). Regenerate reuses the stored request of the old file, writes a new episode with a new id, removes the old file after generation succeeds, and commits both in one `feat(podcast): replace <old> with <new>`. The feedback reaches the writer as an optional `ScriptInput.feedback`, rendered in the user message inside the untrusted-text wrapper and never overriding the rules about facts and numbers. The new file records `replaces` and `feedback` (optional, so old files parse). `--dry-run` generates or reports and removes nothing.
- Why: the owner wanted to delete an episode after it is made, and to regenerate it with extra feedback when the content is not right.
- Cost: a regeneration is a full writer run. A failed one leaves the old episode in place.
- Rejected: editing an episode in place (script, audio and checks are made together); keeping the old episode beside the new one.

## D43: General episodes are built from general-news feeds, ranked by coverage

- Date: 2026-10-08
- Decision: a request with `audience: "general"` takes `topic_ids` only from `GENERAL_TOPICS` (world, business, technology, science, culture, sports; validated in core) and is built from `config/general-feeds.json`: 3 or 4 open category feeds per topic (NPR, ABC, CBS, Sky, PBS, BBC, Al Jazeera, ScienceDaily, ESPN, The Guardian), read with the engine feed reader, kept inside the request window (feeds hold a day or two; a longer window is not an error), clustered across outlets with the `news` profile of `clusterStories`, ranked by outlets covering the story, then recency. The top stories across all chosen topics (a quarter of the length, 1 to 4) open the episode; the other slots go round-robin to the topics. Story text is the feed title and description. No briefing story, Jev, Exa or Firecrawl: the one model call is the script writer, with the D39 `general` prompt and the same number check. If every feed fails, or fewer than 3 stories are found, the run fails with a plain message and never falls back to briefing stories. `custom` and absent audiences are unchanged. Also for both kinds: the writer is asked for 90 to 100 percent of the length and a reply under 80 percent is sent back (up to 3 calls), then kept with `short_by_chars` recorded; a chosen topic with no story in the window is named in the result, and a request whose topics all have none fails instead of becoming a top-picks-only episode.
- Why: the owner wanted General mode to cover the topics of a general news podcast, with few sources so there is no noise and no Firecrawl rate limit.
- Cost: 4 to 24 feed fetches and one writer call per episode (up to 3 when the script is short); no key beyond the writer.
- Rejected: briefing stories for General; scraping or search sources for general topics; a model call to rank or summarise stories.

## D42: One Jev request per item, and a per-run Firecrawl ceiling

- Date: 2026-10-08
- Decision: An item that needs the six main questions and topic-fit questions gets one Jev request with both sets (`judge/combinedJudge.ts`); the answers are split into the same cache entries as before, so no hash changed. An item from a source tagged for a coverage topic (Trending) with no category hint is asked only its fit question and scored with a neutral main judgment that is never cached. Firecrawl is held to 30 requests a run (`fetch/firecrawlBudget.ts`): 16 for listing pages, the rest for scrapes. Listing sources over the allowance wait, oldest `last_ok` first, so the skipped set rotates, and the skip is recorded. The weekly pass reuses the regular pass's pages. The scrape fallback runs only for selected items and not when 600 characters are already in hand. A 429 backs off; three stop Firecrawl for the run. Requests per service go to `.cache/run/spend.json`, the run report and `state/last-run.json` (`spend`).
- Why: the owner asked to keep paid calls low without losing curation quality.
- Rejected: sharing one request across items (Jev takes one item's state); cutting sources.
- Cost: a Trending item loses the hype, sponsored and funding penalties; an item with 200 to 599 characters of text no longer gets a paid scrape; a Firecrawl source skipped for the ceiling waits a run.

## D45: The briefing's hour, cadence and topics are set in Settings

- Date: 2026-10-08
- Decision: the hour (Stockholm), the cadence (1, 2, 3 or 7 days) and the covered sections of the scheduled briefing live in `config/schedule.json`, written by the `schedule.set` config op from Settings, Schedule. A missing file means 07:00, every second day, every enabled topic. `run.yml` carries one schedule entry per hour, and its job runs only for the entry that equals the repository variable `RUN_CRON`, which the site sets when the hour is saved.
- Why: the owner asked to choose when the briefing is made and what it covers, from the app. The repository is private, so an hourly job that gates itself would bill up to 744 minutes a month; a job skipped by its `if` starts no runner and costs nothing.
- Cost: the hour lives in two places (the file for display, the variable for the trigger). If the variable cannot be written the page says so and the rest is still saved. GitHub can still fire a schedule hours late.
- Owner: add "Variables: Read and write" to the site's GitHub token, and merge the workflow change by hand.
- Rejected: an hourly job with a gate (minutes); Vercel Cron (once a day on the Hobby plan, static, imprecise); letting the app edit the workflow file (the token cannot change workflows).

## D46: The writer's provider and model are chosen in Settings

- Date: 2026-10-09
- Decision: the provider (Nebius, the only one) and the model of the writer live in `config/writer.json`, written by the `writer.set` config op from Settings, Model. A missing or unreadable file means "Automatic". The engine tries, in order and without repeats, the Settings model, `DISPATCH_MODEL`, then `DISPATCH_FALLBACK_MODEL`; a Settings model that fails for any reason falls through. The live list comes from `GET /api/models`, a site function that asks Nebius with a server-side key and is cached for an hour.
- Why: the owner asked to pick the model, and the provider, from the app. D24 already said model ids change and must come from the live list; this puts that list where the choice is made.
- Cost: `NEBIUS_API_KEY` must also be on Vercel, a second place to rotate it. Until it is, the page offers the saved model and a typed id. One failed call on the Settings model moves the rest of that run to the environment's model.
- Owner: run `npm run secrets:push` once.
- Rejected: writing the `DISPATCH_MODEL` repository variable from the site (needs the token's Variables permission and gives no fallback); a list saved by the engine at each run (stale by up to two days, and a new file for the run's write guard to allow); a native select of sixty ids (no filter).
- Supersedes: the "set the two variables" step of D24 for choosing a model. The variables remain the fallback.

## D47: A move between pages is answered from a saved copy and swapped at once

- Date: 2026-10-09
- Decision: the service worker answers a move inside the app (the client router's fetch, or a prefetch) from a copy of the page saved in the last ten minutes, and asks the network behind it; a page load still waits for the network. A changed page is reported to the page on screen, which refreshes quietly if nobody has touched it. A new `/latest.json` makes every saved page old again, except briefings. Once the page is idle, the router's view transition is replaced for a move by an immediate swap, and the incoming page fades up by itself in 100 ms (150 ms with the 8px settle into or out of a briefing). The theme change keeps its view transition.
- Why: measured on production, a move took about 400 ms to a fully drawn page with the new page ready after 70. The network was not the cause on a fast connection; the transition was, and it was not the designed one (see learnings). A view transition also spends two frames taking pictures before anything moves. After the change the same script measures 2 ms for the page, 32 ms to the new page on screen and 132 ms fully drawn.
- Cost: `document.startViewTransition` is stood in for, for one call, during a move; a move in the first moment after a page load still uses the browser's transition. A saved page can be up to ten minutes old for one view before the quiet refresh. The service worker is more than "offline reading and nothing else" now.
- Rejected: network-first with a shorter wait (still a round trip per move); stale-while-revalidate with no age limit (a two-day-old Today for a moment); keeping the view transition with shorter timings (still two frames late).
- Supersedes: the "fade through" between destinations described in the stylesheet before this date.

## D48: One shader: a light in the cover's colours behind the header, on a GPU only

- Date: 2026-10-09
- Decision: the header of Today and of an episode has a soft field of light in the cover's colours behind it. A CSS layer is the light everywhere; where WebGL draws on a GPU a small canvas (128px on its long side, scaled up, which is the blur) fades in over it and drifts through one cycle in 40 s or more, at 30 frames a second at most, only while the header is on screen and the tab is visible. Reduced motion and data saver get one still frame. A software renderer, a missing or lost context and forced colours get the CSS layer or nothing. The layer is the header's own box and fades to nothing on all four sides.
- Why: the owner asked for a clever but mild use of shaders. The cover is the one thing that differs from day to day, so its colours are the only decoration that says something.
- Cost: 325 bytes of eager JavaScript on those two page types and 2.3 KB loaded on idle. The canvas path cannot run in CI, where Chromium draws on the processor; it is checked by a script in a real window. The play chip stands on the page's surface inside a header, because its accent text fell short of 4.5:1 over the light.
- Rejected: a shader behind the whole page or the navigation (not mild); a CSS `filter: blur` (repaints, and costs more than the canvas); a library (the budget has 0.1 KB left); drawing on a software renderer (a warning per frame and a busy processor for a decoration).

## D49: One Podcast settings page: Daily, Weekly and Custom profiles, a shared writer, topics and sources clubbed

- Date: 2026-10-10
- Decision: Settings has one "Podcast" row. `/settings/podcast` holds one configuration with three profiles (Daily: hour and cadence; Weekly: day and hour; Custom: the Create panel's defaults), each with a Type (Readout or Discussion), a Length and Voices (Ada, and Leo for a Discussion), and one shared Model (a vendor select, Nebius or Anthropic, then a model combobox). Topics and sources are one tab, `/settings/podcast/topics`: each topic has a weight (a hint; the model still decides per run) and its sources with a 0 to 5 quality score, and an Add source panel previews a URL (name, icon, feed, score) before it is added. Headlines is not offered for new requests.
- Why: the owner called Settings "a mess" and asked for one podcast configuration, a clubbed topics and sources view with a rating per source, a discoverable Add source, and a voice choice for Daily, Weekly and manual episodes.
- Cost: the daily Type is saved but the audio workflow does not apply it (a workflow change); a weekly run at its own hour needs a `RUN_CRON_WEEKLY` variable in `run.yml`; `/api/source-preview`, `/api/site-icon` and `/api/voices` are open like `/api/models` (SSRF-guarded, cached); the heaviest page has 0.3 KB of budget left.
- Rejected: favicons straight from each host (needs `img-src https:`, loosening the policy; they go through `/api/site-icon`); per-profile models (the owner asked for one vendor and model in general); a quota per topic (the weight is a hint).
- Supersedes: the Schedule and Model pages (D45, D46 placement), the separate Topics and Sources pages.

## D50: The open player: a speed slider, Chapters or a Speechify-style transcript, word marks stored beside each segment

- Date: 2026-10-10
- Decision: the open player has no header (no "Now playing", no chevron); closing is a drag, the bar, Back or Escape, with a "Close the player" button that shows only on keyboard focus. The speed is a button between the skips (a pill under play on a phone, so the five transport controls keep one axis) that opens a slider from 0.5x to 2x in steps of 0.05; the store and preferences accept any step in that range. An episode with chapters shows a Chapters / Transcript switch. The transcript is plain text with a small speaker name, as in Speechify: said words in full ink, the rest muted, the spoken word on a soft fill, a tap on a word plays from it. Speechify's word marks are stored beside each segment's audio (`.marks.json`) and served by `GET /api/narrate-marks`; where a segment has none, word times are estimated from the turn's span by word length. Timeline markers are one small dot per story.
- Why: the owner asked for each of these, and for a mobile layout that is clean and optically balanced.
- Cost: a newly narrated segment costs 2 advanced Blob operations instead of 1 (about 48 newly narrated briefings a month on the Hobby quota); the owner accepted it. A screen-reader user on a phone has no visible close control, only the focus-revealed button.
- Rejected: fetching marks from the Blob host in the browser (needs `connect-src` loosened); returning marks from the narration lookup (a store read per segment on every lookup); the speed beside play on a phone (pulls the row off its axis).

## D51: Settings is two levels and saves itself; every select opens one drawn list

- Date: 2026-10-10
- Decision: The Settings index lists one row per page, each saying what it holds now: Daily, Weekly, Custom, Topics and Model under Podcast; sounds, the theme and About stay on the index. Each page has one job: `/settings/daily`, `/settings/weekly` and `/settings/custom` hold one profile each (Weekly is one switch while it is off); `/settings/model` the writer; `/settings/topics` lists the topics, each leading to its own page (`/settings/topics/<id>`, and `/settings/topics/other` for sources with no topic) with its switch, its weight and its sources. A page's title carries the way back: "Settings > Daily", the parent muted at the title's own size, so there is no back button, no tab bar and no small line above a title. Changes save themselves (`scripts/autosave.ts`): a change waits until the controls have been still for 1.2 s, then every pending edit goes in one request (up to eight ops); a 429 waits as asked and then sends whatever is pending by then; a removal waits 5 s with Undo in the toast; hiding or leaving the page sends what is waiting. The status is the app's toast: Saving, Saved, or the error with Retry. Every select (Settings, Library, Topics, the Create panel, Add source) opens the model list's drawn list through `appearance: base-select`, set in one place (`primitives.css`); browsers without it keep the native list. The model field reads as a select: the hand cursor at rest, the caret once focused, and a press opens the whole list.
- Why: the owner called the podcast settings complex with too many controls, asked for breadcrumbs instead of the back button, for autosave instead of Save, and for every dropdown to look like the Anthropic model list.
- Cost: topics are one level deeper; a removal takes 5 s to send; there is no Discard (a change is undone by changing it back, a removal by Undo); each save is still a `config.yml` run and a commit, about a minute to show.
- Rejected: saving on every change with no settle (a commit per step, and the server's 10 s cooldown); keeping Save for removals only (two ways of saving); a breadcrumb in small text above the title (the owner's type rule); the score filter and sort on Topics (sources are already split by topic and listed best first); a scripted select for every browser (weight on every page that has one, and `base-select` covers Chromium and Safari 27).
- Supersedes: D49's page layout (one Podcast page with a profile switch and two tabs). Its data model (profiles, one shared writer, topics with weights and scored sources) stands.

## D52: On a phone the Create button floats only on Today and the Library, extended until you scroll

- Date: 2026-10-10
- Decision: Below 64rem the floating Create button is rendered only on Today and the Library, the two lists where making an episode is the next thing to do (`BaseLayout.astro`, `data-fab` on the root). Today includes the latest briefing at its dated address (what Share sends), which the navigation marks as Today: it has the button, and pressing Today there goes to its top. Settings, briefings, episodes, Create itself, offline and not found have none, and keep no room for it; the side column carries Create Podcast on wide screens everywhere. Where it shows, it is extended (the plus and "Create") at the top of the page and while scrolling up, and folds to the plus while scrolling down (`scripts/fabScroll.ts`, loaded on the first scroll). Pressing the tab of the page you are on scrolls it to the top instead of loading it again. Back dismisses what is on top before it leaves the page: the Create panel, the Add source panel and the open player; section tabs replace the history entry instead of adding one.
- Why: the owner asked for Android's rule for a floating action (on the screens whose primary action it is, not on Settings) and for patterns that make the phone layout feel native. An unlabelled plus says nothing about what it makes; the extended button says it at the top and gets out of the way while reading, as Gmail's Compose does.
- Cost: a few hundred bytes of script after the first scroll; the button changes width while scrolling (reduced motion: no width animation).
- Rejected: hiding the bottom bar on scroll (Material's navigation bar stays, and playback controls dock on it); a haptic on press (Android only, and the app already has interface sounds); pull to refresh (it would restart a briefing mid-listen, see shell.css).
- Supersedes: the part of the Create placement (state.md, D31 era) that put the floating button on every page.

## D53: First-load JavaScript budget 110 KB, kept as low as the code allows

- Date: 2026-10-10
- Decision: `FIRST_LOAD_BUDGET_BYTES` is 110 KB gzipped (was 104). The budget is a ceiling, not a target: a change that adds first-load script says what it costs, and anything a first visit does not need loads on demand, as the Podcast and Topics editors, the floating button's fold and the navigation boost already do.
- Why: the owner allowed 110 KB and asked to keep it low. The branch measured 103.2 KB on /library with the design pass, 0.8 KB under the old ceiling, so every further change would have been a fight over a few hundred bytes.
- Measured split (2026-10-10, /library): React's client 63.4 KB plus react 3.2 and react-dom 1.4; the player runtime 12.4 (store 2.7, reader sync 1.5, open-player controller 1.4, runtime 1.0, media session 0.7, reader math 0.7, surface view 0.6, switchable audio 0.6); Astro's router 4.2 with prefetch 1.1; the player island 3.8; the layout script 2.5; the sheets island 1.7; icons 1.5; the rest under 1.4 each. Own code is about 27 KB; React is the floor while it loads with every page.
- What could still come off, largest first, in [first-load-js.md](first-load-js.md): React and the player and sheets islands only when there is something to show (about 76 KB off a first visit with nothing playing); the open-player machinery and media session on first play (about 4 KB); the service worker code after load (about 0.2 KB, done).
- Chosen by the owner's delegation (2026-10-10): React keeps loading on idle. On-demand would move a download that never blocks first paint (LCP is CSS, the font and the HTML) to the first press of Play or Create, the app's main actions, which would then wait a network round trip on a cold visit; the service worker serves everything from cache on later visits either way. The open-player machinery stays eager too: about 4 KB against a facade over the gesture code the bar and the page share. Reopen if first visits on mobile data become the measure that matters.
- Rejected: preact/compat (declined by the owner on 2026-10-10); dropping hover prefetch (1.1 KB) or the router (4.2 KB), which make moves between destinations immediate (D47).

## D54: Form fields carry a 3:1 outline; in the player only Play is in full ink

- Date: 2026-10-10
- Decision: Text fields and form selects (Settings, the Add source panel, the Create panel, the Library search) draw their outline in `--field-border` (grey-600: 3.49:1 on the light page, 4.37:1 on the dark) instead of the 1.3:1 hairline, and every field takes the full ink on hover. Toolbar chips, the view switch and the Library sort keep their hairline: their own words say what they are. In the open player, Previous and Next take the muted ink the skips already had, so Play is the one control in full ink.
- Why: the owner left the open decisions to the design pass. The fields have no fill, so their outline is the only thing that shows a field is there; WCAG 1.4.11 asks 3:1 for it, Material's outlined fields meet it, and the token already existed unused. The transport row read dark, light, dark, light, dark (ink mass 156, 100, play, 100, 156); with the helpers equal, the row reads as one control and its helpers.
- Cost: fields look firmer than before; a muted Previous and Next read as secondary, which they are.
- Rejected: a filled field with no outline (a second surface colour on a page that has none); full ink for all five transport controls (Play then stands out by size alone).
- Refined 2026-10-10: in the dark theme a disabled Previous or Next was only 1.67:1 from the muted skips beside it and read as enabled, so the dark disabled ink is one step dimmer (grey-650): 2.37:1 from muted, as the light theme's pair is 2.29:1.


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

## D56: One panel adds a topic or a source and edits a source; Settings has no Custom page

- Date: 2026-10-11
- Decision: Settings' Topics row and page are "Topics & Sources". The page has one outline button, Add ("Add a topic or a source"), that opens one panel (a full-screen sheet on a phone, a side panel from 40rem) with a Topic / Source segmented control under its title.
  - Topic has two steps: the name, what should count and keywords; then up to six catalogue sources whose tags meet its words, leaving out sites already among the sources, each a row to tick. "Add topic and 2 sources" sends one request: `topic.upsert`, then a `source.add` per ticked source with the new topic's id.
  - Source takes an address, looks it up after a 400 ms pause (at once on paste or Enter) and files it under the chosen topic. A topic's own page keeps an outline Add source button that opens the panel on Source with that topic chosen.
  - A source's tile and name are one button that opens the panel to edit it: its name, its topic (one select; Other sends an empty list), a link to its address, and the parts of its score. A new name shows at once; a move says "Moves to X after the next build." Both go as `source.update` (id, name, topic_ids): a seed source keeps the change in its override, an added source is changed in place. A move takes effect in a run: when an override sets a source's topics they decide its category hint, which prefilter and dedupe read (the first built-in category among them; none when they name only custom topics or none). Removing a custom topic strips it from every override; a source left with no topic there goes back to its own topics and hint.
  - Each row has an Open in a new tab button beside its score. A site with no icon shows the first letter of its name in its tile; the site's icon covers the letter once it loads.
  - `/settings/custom` is gone and redirects to `/create`: an episode on request is set up in the Create panel, which still starts from `custom` in `config/schedule.json`.
- Why: the owner asked to add a topic and a source in the same sidebar and sheet, separated by a segmented selector; for good sources as the next step of adding a topic, picked and added at once; to edit existing sources and open their address; for an outline Add source button; for the menu to read Topics & Sources; and said the Custom settings repeat what the Create panel already covers.
- Cost: Create's starting type, length and voices can now be changed only in `config/schedule.json`. A rename or a move shows in its final place after the next build. The panel files a source under one topic, so moving a source that feeds several replaces them with the one chosen.
- Rejected: separate Add topic and Add source buttons (two ways in to one job); the inline Add topic form (no room for the suggestions step); editing the address (a different address is a different source: remove it and add the new one); "Accuracy" as the name of a score part (D55).
- Supersedes: D51's Custom page and its row; D49's Add source panel and the inline add-topic form.

## D57: A topic's page edits its details and adds the sources that suit it; topics are listed by name

- Date: 2026-10-11
- Decision: A topic's page has an Edit topic row that opens the Topics & Sources panel on the topic's details, filled in. A topic the owner made can change its name, what counts and its keywords; one that ships with the app shows its name and what counts read-only and can change its keywords, since the engine keeps a shipped topic's judge question. The second step offers the catalogue sources that suit the topic and are not among its sources yet. Save sends `topic.upsert` with the new details and the switch's current state, then a `source.add` per ticked source, as one request, and the switch's own op takes the new details so a later toggle never brings back the old ones. A renamed custom topic's own section takes the new name, unless its title was set apart. The Topics list and the panel's topic choices are always by name; Other comes last, and a topic that never publishes sorts in with the rest.
- Why: the owner asked to edit topics and their sources, and to always see the topics in alphabetical order. The add flow's two steps are reused, so there is one way of working, and an existing topic gets the same instant add of suitable sources as a new one.
- Cost: a pure rename takes Next and then Save. The new name shows in the list after the next build.
- Rejected: editing a shipped topic's name or what counts (it would change how the topic is judged, and the engine refuses it); suggestions shown on the topic page itself (weight on every load for a choice made rarely); keeping never-publishing topics last (the owner asked for alphabetical, always).

## D58: The Model page offers six top Nebius writers by name, live list or not

- Date: 2026-10-11
- Decision: With Nebius as the provider, the Model list opens with a "Top models" group of six curated writers, best first (`NEBIUS_TOP` in `lib/modelId.ts`): GLM-5.3, Kimi K3, Kimi K2.6, DeepSeek V4 Pro 0813, DeepSeek V4.1 Flash and Qwen3.5 397B. Each is a Token Factory routing key checked on 2026-10-11, ordered by EQ-Bench's longform writing score that day. When the live list (`GET /api/models`) loads, only curated ids it serves show, so a retired one drops out, and the ranked shortlist (`modelRank.ts`) stands in if none is left; "All models" follows. Without the live list all six show, and the typed id field stays for anything else. A pick saves through `writer.set` like any other.
- Why: the owner asked to pick top models from Nebius. Without `NEBIUS_API_KEY` on Vercel the page offered only Automatic and a typed id, so no model could be picked by name.
- Cost: a named list goes stale, as Qwen3-32B did when it left the serverless tier on 2026-08-31; refresh it when Nebius's catalogue or the writing leaderboard moves. Kimi K3 costs about four times the others per token.
- Rejected: Llama (no longer a public endpoint on Nebius); gpt-oss-120b (the lowest writing score of the candidates, 35.8).

## D59: On a phone, Play takes the floating button's place on an episode and an older briefing

- Date: 2026-10-11
- Decision: Below 64rem an episode page and a briefing page that is not Today show a floating Play button where Today and the Library show Create (D52); other pages and wide screens show none. It reads "Play · 5 min" and is named "Play this episode, 5 min" (or "briefing"). It carries `data-play-digest`, so the player plays it exactly as it plays the hero chip: narration first when no audio exists, a spinner while it is made, disabled offline. It extends and folds with scrolling as Create does, and shares its shape (`create-fab play-fab`). Once the player holds this page's audio the bar is its control, so the button steps aside (`data-fab` leaves the root, also on the incoming page before a swap) and comes back when the player holds something else or nothing.
- Why: the owner asked for Play instead of Create on an episode or a briefing on a phone. On a page about one piece of audio, hearing it is the next thing to do, and the hero chip scrolls away with the header.
- Cost: 87 bytes gzipped on every page. Until one is pressed there are two play controls, the chip and the button; the button earns its place once the chip has scrolled off.
- Rejected: a button that turns into Pause (a second pause beside the bar's); Play on Today too (Today is a list destination, where making an episode is the next thing, D52).
- Supersedes: D52's rule that briefings and episodes have no floating button.

## D60: On a phone Create floats on the Library alone; every page with audio floats Play, Today included

- Date: 2026-10-11
- Decision: Below 64rem the floating button is Create on the Library and nowhere else. Today, the latest briefing at its dated address, older briefings and episodes float Play (D59's button, named "Play this briefing, 1 min" or "episode"). A Today with no briefing yet, Settings, Create, offline and not found float nothing. From 64rem the side column carries Create on every page and no floating button shows, as before. Today passes its briefing's audio to the layout, so its button reads the same length as the hero chip.
- Why: the owner: "The only area you can have the create button is the library page, but this logic does not apply to desktop viewport because the create button is always available on the navigation bar", and Play rather than Create on a podcast's page. Today is the latest briefing, a page about one recording, so hearing it is the next thing to do there as well.
- Cost: on a phone, Create is two presses from Today (Library, then Create), and a Today with no briefing offers no way to make one but the Library's. Today has two play controls until the chip scrolls away, so the site specs scope the chip to `.hero`.
- Rejected: Create on Today (D52 called it a list destination; the owner overruled that).
- Supersedes: D52's Create on Today, and D59's rejection of Play on Today.

## D61: Vercel Cron starts the scheduled briefing in its hour; GitHub's schedule is the fallback

- Date: 2026-10-11
- Decision: `apps/web/vercel.json` holds 24 daily crons, `0 H * * *` for every UTC hour, all calling `GET /api/cron/run`. The route needs `Authorization: Bearer <CRON_SECRET>` and refuses every call while the variable is unset or shorter than 16 characters. It reads `config/schedule.json` on main; in the schedule's own hour, Stockholm time (the daily hour, or the weekly slot's hour on its day), it runs the engine's gate (`decideRun`, now exported as `@dispatch/engine/gate`) on `state/last-run.json`, and when a briefing or the weekly pass is due it dispatches `run.yml` with `mode: scheduled`. `run.yml` keeps its hourly entries and `RUN_CRON`: GitHub's late run is the fallback, and the gate ends it gated once the briefing exists.
- Why: GitHub has started scheduled runs 4 to 7 hours late, and dropped some, since 2026-08-26, for many repositories and with no fix (github.com/orgs/community/discussions/207346). Here the 07:13 Stockholm entry ran between 13:11 and 14:02 on each of 7 to 10 October, before and after the hourly entries existed. In that thread, moving the minute, recreating the workflow or using a new repository did not help; an outside trigger calling `workflow_dispatch` did. Vercel's Hobby plan allows 100 crons a project, each once a day and landing anywhere in its hour, so 24 cover every hour, and the route follows the hour chosen in Settings without a redeploy.
- Cost: the briefing starts anywhere in its hour (07:00 to 07:59), not at 07:13. A scheduled briefing is now a `workflow_dispatch` run, so it counts toward Generate's limits (six hours apart, three a day), which GitHub's schedule run never did; adding `run-name` to `run.yml` (a workflow change) would let the limits tell the two apart. One GitHub read every hour, two more in the slot. Vercel does not retry a call that fails to arrive; GitHub's late run covers that day. Owner step: put a random `CRON_SECRET` of 16 or more characters in `.env` and run `npm run secrets:push`; until then the route refuses calls and GitHub's late schedule still runs.
- Rejected: accepting more hourly entries in `run.yml` (each runner it starts costs a minute, and every entry is late); a third-party cron service (one more account holding a credential); a Claude routine as the trigger (a whole session per day for one request); waiting for GitHub to fix it (six weeks without a reply).
- Supersedes: D6's reliance on GitHub's cron for the time of day (its date gate stays), and D45's `RUN_CRON` as the trigger (it stays as the fallback).

## D62: Daily and Weekly each choose their topics; voice samples play through the site

- Date: 2026-10-11
- Decision: The Daily and Weekly settings pages each have a Topics row: one chip per section with a topic that is on and may publish, by name, all ticked by default. All ticked is stored as null (every topic, including ones added later); fewer is the list of section ids; the last ticked chip cannot be unticked; Top picks is always covered. The weekly profile gains `weekly.sections` in `config/schedule.json` (null by default), validated by `schedule.set` as the daily list is, and the weekly pass is narrowed by it in every mode (it used to cover every section). Voice samples play through `GET /api/voice-sample?voice=<id>`, which fetches only a sample in the cached Speechify list, caps it at 2 MB and answers byte ranges; `/api/voices` also names the voices Default stands for. Choosing a voice plays its sample, and a Sample chip (the app's play chip) plays it again or stops it.
- Why: the owner asked to choose topics in Daily and Weekly and to preview voices in an intuitive way. The old play button pointed at Speechify's own host, which the page's `media-src` blocks, so in production a press failed and the button hid itself.
- Cost: one function call per sample played (cached at the CDN for a week). A topic added after a narrower list was saved is not in that list until it is ticked. A section left in the file after its topic is removed is ignored, as before.
- Rejected: adding Speechify's host to `media-src` (the host is not documented and can change); a custom voice list with a play button per row (a native select cannot hold buttons, and the drawn list is shared by every select).

## D63: Daily and Weekly leave out topics, one chip per topic, stored as the topics left out

- Date: 2026-10-11
- Decision: The Topics row on Daily and Weekly has one chip per topic (every topic that is on and may publish, by name), not per section. `config/schedule.json` stores `skip_topics` at the top for the daily briefing and in `weekly` for the weekly one: the topics left out, empty by default. `sections` and `weekly.sections` are gone; an older file's `sections` (always null in use) is dropped on read. Selection drops a story whose winning topic is left out, so it reaches Top picks neither. Removing a topic takes it out of both lists. The last ticked chip cannot be unticked. Custom has no setting: the Create panel picks topics per episode.
- Why: the owner asked how to add or remove a topic from the daily and weekly podcasts, and wanted the simplest intuitive answer. D62's chips were sections, so "Design Engineering" stood for five topics and none could be left out alone. Storing what is left out, not what is in, means a topic added later is in both podcasts without anyone remembering to tick it.
- Cost: the chips can run to a dozen names. A story that fits two topics follows its winning one.
- Rejected: a scope dropdown per topic (Daily, Weekly, Custom, All): Custom is chosen per episode and "none" repeats the topic's own switch, so two booleans hidden in a menu; switches on each topic page as well (two places for one setting); keeping sections (coarser than the topics the owner names).
- Supersedes: D62's section-based Topics row and `weekly.sections`, and D45's `sections`.

## D64: Every topic can be renamed; what counts edits wherever the judge reads it

- Date: 2026-10-11
- Decision: Edit topic takes a new name on every topic. What counts (the description) edits on a custom topic and on the two that ship with the app (Design, Trending), whose fit question is built from name and description; on a built-in category it stays read-only, with a note that the app judges it by questions of its own. `topic.upsert` sets name, weight and keywords on a built-in topic and name, description, weight, keywords and the switch on an app topic; sections, depth and flags stay the code's. Rewording an app topic re-judges that topic alone on the next run (its question's hash changes); a built-in topic's name is never read by the judge.
- Why: the owner reported that Edit topic would not let them edit text. Every topic they have ships with the app (11 built-in, Design and Trending), so D57 left them only keywords. D57's reason, keeping the judge question, holds for a built-in category's description and for nothing else.
- Cost: an app topic reworded by mistake re-judges its stories once. A built-in topic's description cannot say what the owner means by it; changing that would need its fixed questions rewritten.
- Rejected: letting a built-in description edit (it would read as changing what counts and change nothing); keeping shipped topics read-only (the owner's whole list).
- Supersedes: D57's read-only name and what counts on shipped topics.

## D65: The weekly podcast takes its day; the daily cadence counts from it

- Date: 2026-10-11
- Decision: While the weekly podcast is on, its day (Stockholm date) has no scheduled briefing: the gate (`decideRun`) answers "today is the weekly podcast's day; no briefing" whatever the cadence says, and the weekly pass runs from its hour as before. The daily cadence counts from the later of the last regular run (published or nothing) and the last weekly pass that published, so the briefing after a weekly podcast keeps the cadence's spacing. A forced or on-demand run still makes a briefing on that day. The cron route starts nothing at the daily hour on the weekly day. The Daily page's next-briefing estimate follows the same rule, and its When hint names the day ("Stockholm time, none on Sundays").
- Why: the owner asked that a collision on the weekly day go to the weekly podcast, and chose the cadence counting from it over the briefing coming back the next day. The weekly pass fetches its own seven-day window, so it loses nothing without the day's briefing, and it no longer has the day's best stories claimed by a briefing published minutes earlier.
- Cost: with every second day and a Sunday weekly, the week settles into Tuesday, Thursday and Saturday briefings plus the Sunday weekly. A weekly pass that fails leaves its day with nothing, and the next briefing comes the day after. A weekly pass that found nothing does not count, so the briefing comes the next day.
- Rejected: the briefing the next day (a briefing the morning after the weekly repeats its news); a skipped briefing recorded as its own outcome in `state/last-run.json` (a state schema change for what the weekly record already says).

## D67: Create shows one list of topic chips; the audience presets them; an episode can mix briefing and general topics

- Date: 2026-10-11
- Decision: The Create panel (page and sheet) shows one chip list for both audiences: Design, AI, Technology, World, Business, Science, Culture, Sports, then the owner's own topics. Design sends the briefing sections `design` and `ui-craft`, AI sends `ai`, Technology sends `tech` (the owner's own sources); the rest send their general topic ids. Written for no longer hides chips: switching it replaces the selection with that audience's preset (Somesh: Design, AI, Technology; General: World, Business, Technology, Science, Culture, Sports), and the page starts with Somesh's. The audience still sets how the script is written. The engine splits a request's ids into briefing ids (read from published digests, Top picks always included) and general ids (read from news feeds), shares the episode's story count between the two in proportion to their topics (at least one each), hands unused room to the other, and alternates them strongest first. One side finding nothing is a warning; both is an error. Core no longer refuses a general request with briefing ids. Trending and the general Technology desk are not chips; a stored `technology` reads as `tech`.
- Why: the owner asked for Design, AI and Technology as Somesh's topics "to keep things lean", for Design, AI and Technology to be available in General mode from the sources they chose, and for the selector to change the selection while showing every chip.
- Cost: eight chips where there were five or six. A mixed episode reads digests and feeds, and its two halves were ranked differently (judge scores, outlet coverage), so the alternation is a fair share, not one ranking.
- Rejected: hiding the other audience's chips (the owner wants every chip visible); one chip per briefing section (Design Engineering on its own made the list longer than the owner's three).
- Supersedes: D39's per-audience topic lists and D43's rule that a general episode takes only general ids.

## D68: An episode opens with a rundown, deep-dives its lead stories, gives the rest as nuggets and closes short

- Date: 2026-10-11
- Decision: Readout and discussion scripts follow one order: a one-line hello; a rundown that names the first stories in a clause each (3 at 3 minutes, 4 at 5 and 10, 5 at 15); deep dives on the lead stories (none at 3 minutes, 1 at 5, 2 at 10 and 3 with ten or more stories, 3 at 15 and 4 with fourteen or more), each what happened, why it matters and one concrete detail; the rest as news nuggets of a sentence or two; a short close (about 120, 250, 400 and 600 characters) of one or two questions or implications drawn only from the stories, or reactions a story block itself reports, never an invented opinion; a one-line sign-off. Stories arrive ranked, so the lead stories are the strongest. The frame (hello, rundown, close, sign-off) is sized per length instead of one constant, and the writer is given word counts per part. Headlines keeps its old shape.
- Why: the owner asked for quick teasers of what is in the episode, deep dives into the important stories, and a short thought-provoking close, "focus on the news nuggets".
- Cost: the part sizes are estimates, not measured on real runs, and more stories fit in a length than before (a 15-minute readout carries up to 35, was 31). The close can only pass on what people are saying when a story block quotes it; nothing reads discussion from elsewhere.
- Rejected: a close built from what people say online (no such source is read, and the writer would invent it).

