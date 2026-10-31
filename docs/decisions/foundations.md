# Decisions: foundations

Stack, repository, hosting, delivery, CI, pull requests, the docs and the tests. Rules and the Index are in [README.md](README.md).

The first build's plan and vision were retired on 2026-10-19: `git show 91bc533:docs/plan/build-plan.md` and `git show 91bc533:docs/plan/vision.md`.

D1 to D9 date from plan v2 (2026-10-05). D10 to D25 date from 2026-10-06. Reasons are the plan's working rationale; correct any the owner would state differently.

## D1: Engine runs on GitHub Actions

- Date: 2026-10-05
- Status: Confirmed. Replaces the earlier choice of a Claude Code cloud routine.
- Decision: The curation engine runs as a CLI (`dispatch run`) on GitHub Actions. Every other trigger (site button, skills, laptop) is a thin caller of the same CLI.
- Reason: Routines push to `claude/` branches by default, start with a restricted network allowlist, and expose an experimental trigger limited to 30 fires per hour. Actions is stable, has full network access and its own secret store. Model and judgment spend stays well under 1 USD a month, so the host choice is not a cost question.
- Rejected: A Claude Code cloud routine as the engine (limits above, and an agent with tools reading untrusted web text is the worst case for prompt injection). A laptop-only cron (misses runs when the machine is off). Claude API for curation (Nebius and Jev were chosen instead).

## D2: The repository lives in this folder

- Date: 2026-10-05
- Status: Confirmed
- Decision: The repository root is the owner's existing project folder on the laptop, five levels under the home directory.
- Reason: It already holds the planning files. The base path is 66 characters, and deep `node_modules` paths can approach the 260-character Windows limit, so enabling long paths is optional hardening that needs the owner's approval.
- Rejected: A shorter path elsewhere on disk.

## D4: Astro with React islands, Base UI and hand-written token CSS

- Date: 2026-10-05
- Status: Decided. Rationale in build-plan Section 8.1.
- Decision: The web app is Astro with React islands, Base UI for accessible unstyled parts, and CSS custom properties compiled from design tokens.
- Reason: Reading is HTML first with near-zero JavaScript. The audio element lives in a module, so it survives navigation. Base UI keeps the look ours.
- Rejected: A Vite React SPA with a router (heavier for a reading app). SvelteKit (leaves the React and Base UI ecosystem). Tailwind and shadcn (a templated look; the shadcn and Radix drawer rests on Vaul, which is unmaintained).

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

## D19: TypeScript 6 pinned repository-wide

- Date: 2026-10-06
- Status: Confirmed
- Decision: The root and `apps/web` pin `typescript` to `~6.0.3`, so the whole repository typechecks with one compiler.
- Reason: The Astro language tooling behind `astro check` breaks under TypeScript 7, and two versions in one workspace would check the engine and the site against different compilers.
- Rejected: TypeScript 7 with `astro check` dropped (loses type checks in templates). A different version per workspace.
- Revisit if: The Astro tooling supports TypeScript 7.

## D22: `deploy.yml` owns the deploy

- Date: 2026-10-06
- Status: Superseded by D25. As-built detail of D10, which held the commands and the reason for leaving the Git integration off.
- Decision: `deploy.yml` is a reusable workflow with its own concurrency group, `deploy`. It checks out `main`, not the caller's commit, and passes `VERCEL_TOKEN` only to the Vercel pull and deploy steps, never to the build.
- Reason: A called workflow that shares its caller's concurrency group is cancelled. The caller's commit predates the bot commit. The build runs repository code and dependencies, so it gets no token.
- Rejected: Sharing `run.yml`'s group. A token at job level. Deploying the caller's commit.

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

## D27: Owner and Dependabot pull requests merge automatically

- Decision: `automerge.yml` squash-merges a pull request when `ci` passes on its current head and the author is the owner or Dependabot. Dependabot skips major versions.
- Why: branch protection would block the digest commits that push to `main`, so the merge rule lives in a workflow instead.
- Limit: the workflow token cannot merge changes to `.github/workflows`; those merge by hand.

## D38: Subagents are few, narrow, enforced and capped

- Date: 2026-10-08
- Decision: Ten agents, each with one job, a model tier, `effort`, `maxTurns` and (except `general-purpose`) a tool allowlist in its frontmatter. User level (`~/.claude/agents/`): `Explore` (overrides the built-in, haiku), `general-purpose` (overrides the built-in, sonnet, core tools and web only, no MCP because the full MCP schemas cost about 289k tokens per call; 118 of 214 past calls used it on the main model; the `claude` agent covers MCP tasks), `scout` retired, `planner`, `reviewer`, `ui-critic`, `motion-reviewer`, `researcher`, `deep`. Project level (`.claude/agents/`): `dispatch-verify` (haiku; typecheck, tests, lint, build, 102 KB budget) and `dispatch-worker` (sonnet; one workstream in a worktree, never merges). Read-only agents run Bash through `~/.claude/hooks/readonly-bash.mjs`. No agent preloads a skill and no plugin is enabled for them. Subagent cache TTL is 1 hour; at most 4 concurrent agents, depth 1. Effort is chosen once at first launch (rule in the global CLAUDE.md). `/close-session` is a main-thread skill because a subagent cannot see the conversation.
- Why: delegation costs about 4x chat tokens and multi-agent about 15x, so an agent earns its place only by reading a lot and returning a little. Prose "read-only" did not stop `deep` and `motion-reviewer` inheriting every tool.
- Rejected: preloading design skills into `ui-critic` (full text on every run); enabling `motion-design` for `motion-reviewer`; agent teams; a docs-keeper agent.
- Status: active. Hook, tool allowlists, overrides and `dispatch-verify` verified in a fresh session; the rest is listed in state.md.

## D81: A workflow installs only what it runs; the audio job skips the Vercel pull when the Blob token is set

- Date: 2026-10-12
- Decision: `run.yml`, `podcast.yml`, `config.yml` and `audio.yml` install with `npm ci --ignore-scripts --workspace=packages/engine --include-workspace-root` (118 packages, not 445). `audio.yml` skips `vercel link` and `vercel env pull` when `BLOB_READ_WRITE_TOKEN` is set, since the engine ignores the pulled pair then. Changes under `.github/workflows` need a manual merge by the owner.
- Why: the install was 10.4 s against 4.3 s on a warm cache, paid on every episode, every settings save and every briefing; `audio.yml` has failed at `vercel link` ("User not found") while `VERCEL_TOKEN` was dead, so the latest briefings had no stored audio and their first Play synthesised (3 to 6 s).
- Cost: the audio job still pulls when no Blob token secret exists. Vercel shows a store's long-lived token once and then hides it (D26), so the usual fix is the owner replacing `VERCEL_TOKEN`; `BLOB_READ_WRITE_TOKEN` as a GitHub secret works if they still have it.
- Rejected: caching `node_modules` (a saving nobody measured, beside an install that now takes 4 seconds); one concurrency group for `config.yml` of its own (it shares `dispatch` with `run.yml` on purpose, so two commits never push at once).

## D99: The test suite protects what fails silently, in one layer, once; the dev lab is retired; a refused model choice, a lost held change and a press in a failure are told

- Date: 2026-10-12
- Decision (the owner's test-suite audit, and the ninth critic round):
  - A test earns its place by naming the bug it prevents, and the bugs worth a test are the ones a person cannot see on a screen: state that survives navigation, reload or time, ordering, money, security, caches, platform quirks, build steps. Copy, CSS, class names, markup, geometry, constants and snapshots are not pinned; screenshots and journey critics judge them, and design rules are held by one rule table and by Biome (`noImportantStyles` is an error). One behaviour has one test in one layer. The evidence and the rules are in [the postmortem](../engineering/postmortem-test-suite.md), and `AGENTS.md` carries them.
  - A browser test runs once: on the phone unless it is tagged `@desktop` (desktop only) or `@both`. The player suite runs only against the fixture site (`@desktop` and `@wide` add a 1280 mouse run; `PLAYER_WEBKIT=1` adds an iPhone `@smoke` set, unrun here); `retries` is 0. The dev lab (`src/player/dev`, `astro dev` as a second web server, its 67 lab-only tests) and the Settings sheet only it could open are deleted: the player specs drive the product page.
  - Real code, fake world: handler tests keep the real passphrase verifier and give it a cheap hash in the real format (the verifier reads N, r and p from the stored value); the server's 10.25 s edit gap runs on `page.clock`; engine tests read frozen config under `packages/engine/test/fixtures/config`, and only `committed-data.test.ts` reads the live config and state; `workflow-contract.test.ts` runs every `dispatch` call in `.github/workflows` through the CLI's parser. Briefs no longer say "add a test for every fix"; `dispatch-worker` and `/close-session` carry the rule; a worker's report states its net test count; the browser suites have a budget (unit 2 minutes, site 7, player 4, on a 4-core container).
  - Round nine: the Model page's own note is written only once its request was accepted (a refused choice no longer reads Saved after a reload or on the Settings index; a choice still waiting is read from the pending edits); a held change refused while Today or the Library is open is told in the app's toast ("Your change to Daily was not saved.", with Open); a story whose file a standing refusal cannot make fails at its start, so a press plays nothing of the story before it and says no "Playing."; offline a press repeats its reason and loads nothing; a retry is announced as what asked for it; a press on Play in a failure scrolls the notice into view when the page was scrolled past it (a failure that only arrives scrolls nothing); the Library's long query is quoted to 24 characters, New episode stays under "No episodes yet", and the empty Library no longer scrolls; the wordmark names the briefing only when there is one.
- Why: the owner called the suite ridiculous for a simple application. Four read-only audits found the unit layer mostly earned (88% of the engine's tests and 92% of the web unit tests kept) and the browser layers full of change detectors, duplicates, dead targets and one second target: 29% of the site e2e declarations and 41% of the player e2e ones to delete and a quarter more to merge, 1,935 listed runs, about 32 minutes, none in CI. The suite had also passed every P1 that critics found by walking journeys. The postmortem names the causes: briefs and records that only ever said to add tests, green as the only exit criterion, no owner for the suite, and tests aimed at what is easy to assert.
- Cost: unit tests fell only 4% (the rest is real logic), browser runs from 1,935 to 429 and their time from about 32 minutes to about 10. The cuts rest on code reading and on a check that re-breaking each fix of the branch still fails a surviving test, not on mutation testing. The browser suites are still outside CI, the site suite at 6.4 minutes is not yet as lean as the audit's 4 to 5, and the WebKit set is unverified. The model note, the held-change toast and the notice scroll add a little code to lazy chunks; the largest first load is 109.4 KB of 110.
- Rejected: one shared passphrase gate for the four POST handlers (their checks differ in what they read and in order, so it is not a pure move); a fake verifier (the real one is cheap with a cheap hash); a CI job for a phone `@smoke` set and a WebKit project (workflow changes the owner merges by hand, listed under Next); mutation testing.
- Amends: D91 (the held change, now also when it is refused away from Settings), D97 (the Model note) and D98 (the notice and the lab).

## D116: docs grouped by purpose

- Date: 2026-10-14 (the owner: "the docs folder has a lot of loose docs, consolidate them")
- Decision:
  - The record stays at the top of `docs/`: `state.md`, `decisions.md`, `learnings.md`, `history/`, the design-engineering ledger and the runbook.
  - The first build's plan moves to `plan/` (`vision.md`, `build-plan.md`), each marked as the original plan that later decisions override.
  - Measurements and the test postmortem move to `engineering/`.
  - A point-in-time audit is not a standing doc: its tables go into that session's history note, and its open items into the ledger's gaps.
  - `docs/README.md` maps every doc. It and `history/README.md` are the only names outside D14's kebab-case.
- Why: thirteen loose files at the top mixed the live record with a superseded plan and two finished audits, and two of them still said nothing had run live.
- Cost: links into the moved files changed; a link check found no new broken links.
- Rejected: moving `design/` and `prototype/`, which build scripts and tests name by path.

## D140: the design system, enforced

- Date: 2026-10-21 (the owner: "everything ui related ... must respect design system. implement either a hook/linter/audit pass"; "why drift to other icons when we have an icon library")
- Decision: `npm run design-check` holds tokens-only colour, type and easing, no raw SVG outside the Icon components, shared classes for every control (a reasoned allowlist that only shrinks), the 8pt grid, flat surfaces and regular headings. A PostToolUse hook runs it after any edit under `apps/web/src` or `tokens`. The `design-audit` agent screenshots a UI change before its PR. Icons come from `@phosphor-icons/core` through `npm run glyphs`, and a test fails on any path that differs from the package.
- Why: icons had been redrawn by hand because nothing tied the glyph file to the library, and every check before ran only when someone remembered.

## D143: a code review before every merge

- Date: 2026-10-21 (the owner: "Code review before every merge is mandatory", after #185 and #186 merged with no review)
- Decision: every PR is opened with the `review` label. `claude-code-review.yml` reviews it and `automerge.yml` skips it, so it merges by hand once the review has landed and its blocking findings are fixed. A large change also gets the `/code-review` skill on the branch before the PR.
- Why: two large PRs auto-merged on green CI with no review, and the review run afterwards on the merged diff found real bugs (a broken import, cost records that overwrote each other, a paid call on empty text).
- Cost: no PR merges itself any more; each waits for a review run and a hand merge.
- Amends: amended by D192 (CodeRabbit replaces claude-code-review.yml).

## D148: CI fits the free Actions minutes

- Date: 2026-10-22 (every workflow stopped: the private repository had spent its monthly Actions minutes, and the owner will not pay for more)
- Decision: `ci.yml` runs on pull requests only, not again on each push to `main`, as one `check` job (each job bills whole minutes). Its `browser` job (both suites) runs for a change to `tokens/` or `player.css`, `primitives.css` or `buttons.css`, for a Dependabot pull request, and for one labelled `browser`; every other change runs both suites locally before its pull request. `episode-eval.yml` runs only for the writer, the judges, the voice and `loop/`. `automerge.yml` starts only for Dependabot. Push to a pull request once the local gate passes, not per fix.
- Why: in the week to 2026-10-22 CI took about 880 minutes and the episode eval 290, the briefing runs 22. A full CI run billed 25 minutes, 19 of them the browser job. That used the cap that the briefings, audio and health runs need. A push to `main` re-checked code its pull request had checked and ran for every digest commit. The shared stylesheets and tokens hold most of the load-bearing design fixes the 2026-10-18 rule guards.

## D151: CI fails on a high advisory in what ships; path-to-regexp is held at 6.3.0

- Date: 2026-10-22
- Decision: the CI audit step runs `npm audit --omit=dev --audit-level=high` (was `critical`). The one high advisory, GHSA-9wv6-86v2-598j in `path-to-regexp` 6.1.0 (an exact pin of `@vercel/routing-utils` under `@astrojs/vercel`), is answered by a root `overrides` entry that holds it at 6.3.0, the patched release of the same major.
- Why: hardening.md recommended it; Dependabot cannot fix an exact pin, and the upstream fix was a major of the adapter.
- Cost: routing-utils builds route regexes with 6.1.0 on purpose and compiles each with 6.3.0 only to log `[vc] PATH TO REGEXP PATH DIFF`; with both at 6.3.0 that warning can never fire, and a pattern with two parameters in one segment (`/:a-:b`) compiles differently. Today's output is identical (`.vercel/output/config.json` and every `.vc-config.json`, 39 routes) and the unoverridden build logged no diff. After a change to `vercel.json`'s sources or the adapter, diff `config.json` against `main`. A new high advisory with no fix in range turns every PR red until it is answered.
- 2026-10-24: two more high advisories. `undici` (GHSA-xjj6-f33q-929c) moved inside its declared ranges to 6.29.1 under `@vercel/blob` and 8.12.3 under `unifont`, no override; `zod` 4.1.11, an exact pin in `@vercel/cli-config` under `@vercel/blob`, is held at 4.6.7 (the version the rest of the tree uses) by a second override.
- Revisit if: `@vercel/routing-utils` pins a patched `path-to-regexp` (drop the override), or a high advisory has no fix to take (decide then: an override, or accept it here by name).

## D175: `main` is protected by a ruleset, with the Actions app as the only bypass

- Date: 2026-10-24 (the owner: "Rulesets for main branch to have industry grade checks and quality checks to make sure main branch is always stable")
- Decision: a GitHub ruleset on the default branch, kept in `.github/rulesets/main.json` (runbook 12): no deletion, no force push, linear history, every change through a pull request with its threads resolved and squash as the only merge method, the `check` and `browser` jobs required and the branch up to date with `main` at merge time. The GitHub Actions app bypasses it always, so the engine's own commits (digests, narration, episodes, config) keep landing; no person does.
- Why: on 2026-10-24 two PRs that each passed CI alone put `main` over the learnings budget, so `docsCheck` failed on `main` itself; and nothing stopped a direct push or a force push. Strict required checks test the merged state; the ruleset turns D143's "review before every merge" and D148's "CI on pull requests" from habit into a rule the host enforces.
- Cost: each merge first updates its branch and waits for CI again (about 4 minutes, 15 with the browser suites); with several PRs open they merge one at a time. Rulesets on a private repository need GitHub Pro.
- Rejected: requiring the `review` check (Dependabot's PRs merge without the label, and the review runs only when the label is added); required approvals (one owner cannot approve their own PR); signed commits (the engine's are unsigned); a person as a bypass actor (then the rule is a habit again).
- Revisit if: a workflow starts pushing with a token that is not the Actions app's (it would need its own bypass), or merges queue up behind the strict check for longer than they save.

## D192: CodeRabbit is the default PR review agent

- Date: 2026-10-25 (the owner: "I have installed code rabbit on github, where do I change to use it as default review agent?").
- Decision: CodeRabbit replaces `claude-code-review.yml` as the automated review agent on GitHub. `.coderabbit.yaml` defines repository conventions (no em dashes, 8pt grid, shared design tokens, TypeScript 6.x, snake_case data keys, and excludes `Digests/`, `Podcasts/`, and `state/`). Reviews run automatically on pull requests without requiring label triggers or Actions runner minutes; a human merges once findings are resolved. Local `/code-review` remains available for pre-PR checks.
- Why: CodeRabbit reviews incrementally on each commit, supports threaded conversation, and avoids the single-run and re-label limits of the Claude action (learning 2026-10-11).
- Rejected: keeping `claude-code-review.yml` in parallel (duplicate comments and Anthropic token spend); relying on manual review only.
- Amends: D143.

## D206: stay on npm for now; pnpm was spiked and works locally

- Date: 2026-10-28 (the owner: "welcome to upgrade to pnpm as a final task").
- Decision: no migration yet. A scratch worktree ran install, typecheck, 4,960 unit tests and the static build under pnpm 10.28; [pnpm-migration](../engineering/pnpm-migration.md) lists the five changes it needs.
- Why: the install is about 6 s against about 15 s (unlike cache states, so only an indication), against a daily run of 2 to 3 minutes. The change touches ten workflow files (a manual merge each), Vercel's install and a new pinned action, and none of that can be tried here; a mistake stops the daily briefing, which is the thing this branch exists to make reliable (AGENTS.md: pipeline discipline). One task per branch.
- Revisit if: install time or disk use in CI or on the owner's machines becomes a cost, or Dependabot or Vercel drop npm; then do it on its own branch with a CI run before the merge.

## D210: dual-rendering parity uses typed HTML builders; blast radius analysis is advisory

- Date: 2026-10-28.
- Decision: dynamic client-side DOM updates that re-render Astro pre-rendered blocks (e.g. Structure view in Preferences, `structureView.ts`) use pure typed HTML generator functions (`sheetHead.ts`) with internal HTML escaping and data attributes, rather than client hydration islands or duplicated string concatenation. Blast radius inspection is implemented as an advisory CLI check (`scripts/blastRadius.mjs`, `npm run blast-radius`) mapping modified surfaces to consumers and suggested tests, without blocking git commits.
- Why: Astro cannot run its components inside vanilla DOM client scripts without hydrating full islands, which inflates the 130 KB bundle budget (D141). Hand-concatenated markup strings across files caused silent attribute and escaping divergence. Advisory blast radius alerts agents to consumer surfaces without creating brittle git-level blockers against required test mutations.
- Revisit if: client DOM state management requires reactive framework islands.

## D254: one PR per task, one rolling design-system PR, small fixes batched

- Date: 2026-10-30 (the owner: "I feel there are way too many PRs being raised instead of combining many changes into one"). Amends D237, D143.
- Context changed: D237 gave each design-system change its own PR, and D143 reviews every PR, so one feature that touched a component became two PRs. A day of that spent CodeRabbit's reviews (about 10 an hour), Vercel's 100 deploys per 24 hours and the owner's hand-merge queue.
- Decision: a thread opens one PR per task; review fixes and follow-ups go on that branch, never a new PR. Design-system changes collect in one rolling `design-system` PR at a time, which still holds nothing else (D237) and which the owner merges by hand; a new one opens only after the last has merged. Small fixes queue until there are enough to bundle, unless one blocks production. The rule is in `AGENTS.md`, the PR template asks which open PR a change could have joined, and the project instructions carry it to every thread.
- Why: the limits that bind are review throughput, deploys and the owner's attention, and each PR spends all three whatever its size. Batching trades a slightly larger review for fewer of them.
- Rejected: a hard cap on open PRs (an urgent fix would wait behind it); one PR per component family (D237's choice; the taste-change-hides-in-the-rest risk is smaller than the queue it makes, and the PR body lists each family).
- Revisit if: a rolling design-system PR grows too large to review in one sitting; then cut it at a family boundary.
- Review scope (the owner, 2026-10-30: small docs and code changes do not need extensive CodeRabbit reviews). Amends D192. `.coderabbit.yaml` stops reviewing PRs whose title carries `[skip-review]`, and its `path_filters` leave out the docs that hold no rule or decision (`docs/specs`, `prototype`, `reference`, `learnings.md`, `state.md`, `backlog.md`; `Digests/`, `Podcasts/`, `state/` and `docs/history/` already were; `docs/engineering`, `docs/design` and the design ledger keep review, as they hold rules and decisions). A thread may add the keyword only when every changed file is under `docs/` but not `decisions/`, `engineering/`, `design/` or the design ledger (`AGENTS.md` and `.coderabbit.yaml` never qualify), test data or fixtures, or a typo or copy fix of a few lines in code (never in `docs/decisions/`) outside the pipeline (`packages/engine`), the store (Blob, Neon, config), auth, billing, `.github/workflows` and the design system; it then merges on green CI. Everything else keeps the full review, and so does every change to `docs/decisions/`, which CodeRabbit checks against the decision-record rules.
- Revisit if: a PR whose files are all filtered out still gets a review (CodeRabbit's docs do not say); then the keyword is the only skip.

## D283: the read-first budget holds, state.md parks its oldest items, and a replaced decision says so

- Date: 2026-10-31 (the improvements backlog, DOC-01 and DOC-02; the owner: go ahead with P0 and P1).
- Context changed: read-first (AGENTS.md, state.md and the Index) sat at 39,992 of 40,000 bytes, so the next decision would fail the gate for every open PR. Separately, D136 "replaces D46, D58, D113, D130" while their Index rows still said active, and agents grep the status column.
- Decision: the 40 KB budget and the Index's place in it stay. state.md makes room by moving its oldest, least active unverified items word for word to a history note (`docs/history/2026-10-31-state-trim.md`), each keeping its `closed when:`. A row that says "replaces Dn" is a failure in `scripts/docsCheck.mjs` unless Dn's row says "superseded by"; the stale rows were set. A decision that changes only part of another says "amends".
- Why: the Index is what agents grep, so it is the one file whose size is worth paying for; the parked items are open but quiet. A check that reads the status column cannot be forgotten like the procedure in this file's header.
- Rejected: stop counting the Index (it would let it grow without bound and the first-read cost is real); trimming AGENTS.md (it holds the rules).
- Revisit if: the Index alone passes 30 KB; then split it by area.

