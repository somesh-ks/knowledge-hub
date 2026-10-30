# Singularity

Private design-engineering news briefing. A GitHub Actions engine writes a digest every second day, commits it under `Digests/`, and Vercel deploys the reader at news.someshks.work. Repo: somesh-ks/knowledge-hub.

## Read first

1. [docs/state.md](docs/state.md): what works, what is unverified (each with `closed when:`), what is next. Rewritten, never appended.
2. [docs/learnings.md](docs/learnings.md): gotchas by area. Search it before debugging.
3. [docs/decisions/](docs/decisions/README.md): grep the Index; open an area file only for an entry's reasoning.

On demand: [docs/specs/](docs/specs/README.md) for what a capability does (code and tests win; fix a wrong spec), [docs/history/](docs/history/README.md) for the why of a past change, and [the test postmortem](docs/engineering/postmortem-test-suite.md) before you add, change or delete a test. `node scripts/docsCheck.mjs` (in the gate) holds the budgets.

[docs/README.md](docs/README.md) maps every doc; [docs/runbook.md](docs/runbook.md) is owner setup. Before UI work, read [docs/design-engineering-ledger.md](docs/design-engineering-ledger.md): the owner's taste, the code's gaps, ideas not yet built.

## Commands

- `npm run singularity -- <command>`: engine CLI (`doctor`, `status`, `models`, `run`, `publish`).
- `npm run gate -- --build`: typecheck, `astro check`, lint, unit tests, the docs check and the static build, in parallel (80 s); all must pass. `npm test`, `npm run typecheck` and `npm run lint` run alone.
- Run commands through PowerShell, not Git Bash: a Git Bash process costs 3 to 8 s here, PowerShell 50 ms ([learnings](docs/learnings.md)). Never stop what listens on port 4321 (the owner's dev server, on `[::1]`; screenshot `http://localhost:4321`); run browser suites with `PORT` set above 4400.
- A worktree gets its packages from `node scripts/worktreeLinks.mjs <path>` and loses them with `--remove` before `git worktree remove`.
- `npm run e2e -w @singularity/web` and `npm run e2e:player -w @singularity/web` (about 6 minutes each): the browser suites. Run both before every PR that touches the site, `packages` or the tokens (CI runs them for some paths), then push once. Red check: [delivery failures](docs/engineering/delivery-failures.md) (D148).
- `SINGULARITY_STATIC_ONLY=1 npm run build`: local site build (the Vercel adapter fails on Windows symlinks).
- `npm run dev`: the site with the Agentation toolbar; `checkBundle` fails a build that contains it. Stop it when done (`npx astro dev stop` in `apps/web`): left running across an install, it serves broken islands.

## Rules

- Never read, print or ask for key values. Keys live in the gitignored `.env`; `npm run secrets:push` sends them to GitHub and Vercel.
- Commits are Conventional Commits. Digest, state and config commits go through the write guard.
- No em dashes. Persisted data is snake_case; docs and config files are lowercase kebab-case.
- Do not edit `Digests/` or `state/` by hand.
- Changes to `.github/workflows` need a manual merge (the auto-merge token cannot merge them).
- Code review before every merge (D143, D192). CodeRabbit reviews PRs on GitHub; merge by hand once its review lands and findings are fixed. Large changes: run `/code-review` first.
- TypeScript stays on 6.x.
- UI keeps the 8pt grid (4px for named cases only) and the design system, in three layers: `npm run design-check` (a hook on each UI edit), e2e/designSystem.spec.ts (CI), the `design-audit` agent before the PR.
- The design system is a product (D237, D251). A control is a component in `apps/web/src/design-system/` named for what it is (Button, not primary action); a page draws it, never types its class. A UI fix starts at the component, never a page override (`styles.test.ts` fails a new one). Changes go in a `design-system` PR the owner merges, with their record.
- Design fixes are load-bearing. Markup or rules with a rationale comment (date, D-number, sizer, specificity bump) are never removed or rewritten to make another task work: extend or ask. Check history (`git log -L '/<selector>/,+20:<file>'`) and the ledger before changing shared CSS (`player.css`, `primitives.css`, `buttons.css`, tokens). CSS is checked by browser suites only.
- Scope: one task per branch. Before a PR, `git diff --stat origin/main` must list only files the task needs; name any shared stylesheet or component in it, and why, in the PR body.
- UI parts: before you write a class, token or value, run `npm run ds -- find "<need>"`. Features: `.claude/skills/feature/`.
- State authority: the config store owns runtime preferences. Never edit `config/` in Git during active workflow runs or from parallel branches without store synchronization (D149, D185).
- Pipeline discipline: verify the core daily loop runs green in production before adding new intake types or audience matrices.

## Tests

Few, one layer each, aimed at what fails silently ([evidence](docs/engineering/postmortem-test-suite.md)).

- An owner-reported "it moves, shakes or jumps" fix gets one browser assertion that the thing holds still, comparing its box to itself, never to a pinned value (the speed spec in `playback.spec.ts` is the pattern).
- A test names the bug it prevents: no sentence, no test. Search the unit, `apps/web/e2e` and `apps/web/src/player/e2e` suites for the behaviour first, and extend or replace a test instead of adding one.
- Test journeys across pages, reload, offline and time, not states. Never pin copy, CSS, class names, markup, geometry or constants: screenshots and critics judge those.
- Fake the clock, crypto and network; freeze fixtures; never sleep or read live config. Test the product page, not a lab.
- Delete or rewrite tests of changed/removed behaviour in the same commit. Streamline tests in the PR: drop old assertions, fold overlaps, keep the suite lean. Only add a test for a logic bug: show it red first, test where logic lives.
- A browser test runs once: on the phone unless it is tagged `@desktop` (desktop only) or `@both`. Counts and run times are in `docs/state.md`; a change that breaks the budget cuts first.

## Keeping the record

Project agents (`singularity-verify`, `singularity-worker`) are in `.claude/agents/`; `/close-session` runs the steps below.

After a large piece of work: clean up scratch files, servers, stashes, and local branches. Review merged diff (CodeRabbit or code-review skill), fix findings, and verify Vercel production deployment.

At the end of a session: update `docs/state.md`, add a decision (next D-number, and a row in the Index) for anything that changes direction, add one line to `docs/learnings.md` per failure, and add a note under `docs/history/`. Keep each fact in one place and link to it.
