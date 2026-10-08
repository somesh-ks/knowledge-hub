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
| D6 | Daily cron with a calendar-date gate, plus a Sunday weekly pass | active |
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
| D39 | Five topics, Top picks always included, General and Customized audiences | active |
| D40 | Trending is ranked by coverage; discovery only suggests | active |

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
