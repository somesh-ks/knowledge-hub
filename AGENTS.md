# Dispatch

Private design-engineering news briefing. A GitHub Actions engine writes a digest every second day, commits it under `Digests/`, and Vercel deploys the reader at news.someshks.work. Repo: somesh-ks/knowledge-hub.

## Read first

1. [docs/state.md](docs/state.md): what works, what is broken, what is next. Rewritten, never appended.
2. [docs/decisions.md](docs/decisions.md): read the Index table; open an entry only when you need its reasoning.
3. [docs/learnings.md](docs/learnings.md): failures and gotchas. Search it before debugging.
4. [docs/history/](docs/history/README.md): one note per session, only for the why behind a change.
5. [docs/engineering/postmortem-test-suite.md](docs/engineering/postmortem-test-suite.md): how the test suite grew past its use and what it missed. Read it before you add, change or delete a test.

[docs/README.md](docs/README.md) maps every doc; [docs/runbook.md](docs/runbook.md) is owner setup. Before UI work, read [docs/design-engineering-ledger.md](docs/design-engineering-ledger.md): every design ask so far, the owner's taste, the code's gaps and the ideas not yet built.

## Commands

- `npm run dispatch -- <command>`: engine CLI (`doctor`, `status`, `models`, `run`, `publish`).
- `npm run gate -- --build`: typecheck, the site's type check (`astro check`), lint, the unit tests and the static build, in parallel (about 80 s). All must pass; prefer it to running them one after another. `npm test`, `npm run typecheck` and `npm run lint` run alone.
- Run commands through PowerShell (`powershell -NoProfile -Command "Set-Location '<repo>'; ..."`), not the agent's Git Bash: each process Git Bash starts costs 3 to 8 s on this machine, PowerShell 50 ms ([learnings](docs/learnings.md)). Never stop what listens on port 4321 (the owner's dev server, on `[::1]`; screenshot `http://localhost:4321`); run browser suites with `PORT` set above 4400.
- A worktree gets its packages from `node scripts/worktreeLinks.mjs <path>` and loses them with `--remove` before `git worktree remove`.
- `npm run e2e -w @dispatch/web` (about 6 minutes) and `npm run e2e:player -w @dispatch/web` (about 3): the browser suites. CI runs both (the `browser` job) when the site, `packages/core` or the tokens change; run them yourself first for a change to a page, a page script, the player or the service worker.
- `DISPATCH_STATIC_ONLY=1 npm run build`: local site build (the Vercel adapter fails on Windows symlinks).
- `npm run dev`: the site with the Agentation toolbar for leaving notes on elements. Development only; `checkBundle` fails a build that contains it. Stop it when done (`npx astro dev stop` in `apps/web`): a server left running across an install serves broken islands.

## Rules

- Never read, print or ask for key values. Keys live in the gitignored `.env`; `npm run secrets:push` sends them to GitHub and Vercel.
- Commits are Conventional Commits. Digest, state and config commits go through the write guard.
- No em dashes. Persisted data is snake_case; docs and config files are lowercase kebab-case.
- Do not edit `Digests/` or `state/` by hand.
- Changes to `.github/workflows` need a manual merge (the auto-merge token cannot merge them).
- Code review: PRs get none by default. There are two ways to get one. (1) The `review` label on GitHub: add it to the PR when you open it; `claude-code-review.yml` runs the review and `automerge.yml` skips a labelled PR, so a human merges it after the review lands (to re-review, remove and re-add the label). (2) The `/code-review` skill: run it on the branch or the commit range yourself, before the PR or after the merge.
- TypeScript stays on 6.x.
- Design fixes are load-bearing. A CSS rule or markup whose comment says why it exists (a date, a D-number, a sizer, "so ... stays put", a specificity bump) is never removed or rewritten to make another task work: extend it, or stop and ask. Before changing a selector in a shared stylesheet (`player.css`, `primitives.css`, `buttons.css`, the tokens), read its history (`git log -L '/<selector>/,+20:<file>'`) and search the [ledger](docs/design-engineering-ledger.md) for it. Unit tests never see CSS: only the browser suites do.
- Scope: one task per branch. Before a PR, `git diff --stat origin/main` must list only files the task needs; name any shared stylesheet or component in it, and why, in the PR body.

## Tests

Few, one layer each, aimed at what fails silently ([evidence](docs/engineering/postmortem-test-suite.md)).

- An owner-reported "it moves, shakes or jumps" fix gets one browser assertion that the thing holds still, comparing its box to itself, never to a pinned value (the speed spec in `playback.spec.ts` is the pattern).
- A test names the bug it prevents: no sentence, no test. Search the unit, `apps/web/e2e` and `apps/web/src/player/e2e` suites for the behaviour first, and extend or replace a test instead of adding one.
- Test journeys across pages, reload, offline and time, not states. Never pin copy, CSS, class names, markup, geometry or constants: screenshots and critics judge those.
- Fake the clock, crypto and network; freeze fixtures; never sleep or read live config. Test the product page, not a lab.
- Delete or rewrite the tests of behaviour you change or remove, in the same commit. Each time you add or remove a feature or a function, streamline its tests in the same PR: drop what pins the old behaviour, fold overlapping specs together, and leave the suite no larger than the change needs. Do not add a test for every fix: add one for a logic bug, show it red without the fix, and put it where the logic lives.
- A browser test runs once: on the phone unless it is tagged `@desktop` (desktop only) or `@both`. Counts and run times are in `docs/state.md`; a change that breaks the budget cuts first.

## Keeping the record

Project agents (`dispatch-verify`, `dispatch-worker`) are in `.claude/agents/`; `/close-session` runs the steps below.

After a large piece of work (several PRs, or one that touches the player, a page or the build): clean up (scratch files, servers, stashes, local branches, leftover remote branches), review the merged diff (the `code-review` skill on the commit range, or the `review` label on a PR) and fix what it finds, then confirm production serves it (Vercel deploys `main`; check the deployment and the live site).

At the end of a session: update `docs/state.md`, add a decision (next D-number, and a row in the Index) for anything that changes direction, add one line to `docs/learnings.md` per failure, and add a note under `docs/history/`. Keep each fact in one place and link to it.
