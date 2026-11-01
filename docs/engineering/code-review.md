# Code review

How a pull request is reviewed, by whom, and when (D143, D192, D254, D292). The decision holds the why; this page is the procedure.

## The tier decides the review

The highest tier of any changed file is the PR's tier. `git diff --stat origin/main` lists the files.

| Tier | Files | Review |
| :--- | :--- | :--- |
| 0, none | Every file under `docs/` but not `decisions/`, `engineering/`, `design/` or the design ledger; test data or fixtures; a typo or copy fix of a few lines in code outside the Tier 2 set | `[skip-review]` in the title; merge on green CI (D254) |
| 1, one review | Everything not in Tier 0 or 2: pages, scripts, styles, tests, `scripts/`, docs that hold rules (`docs/decisions/`, `docs/engineering/`, `docs/design/`, the ledger) | CodeRabbit once, when the PR is ready. Fix or answer each finding. Fix commits merge on green; new logic after the review is asked for again |
| 2, full review | The pipeline (`packages/engine`), the store (Blob, Neon, the config store), auth, billing, `.github/workflows`, the design system's shared files (`tokens/`, `apps/web/src/design-system/`, `primitives.css`, `buttons.css`, `player.css`), `AGENTS.md`, `.coderabbit.yaml`, the gates under `scripts/` | `/code-review` (level high) before the push; CodeRabbit when ready; `@coderabbitai review` after the fixes; merge only when CodeRabbit's "Last reviewed commit" is the head |

A diff over about 400 changed lines or 15 files, at any tier above 0, also gets `/code-review` before the push: a local review spends none of the shared CodeRabbit hour, so CodeRabbit's pass finds less and needs fewer rounds.

## A review is asked for, never fired by a push

`.coderabbit.yaml` sets `auto_incremental_review: false`: CodeRabbit reviews a PR when it opens (or leaves draft), and after that only on `@coderabbitai review`. A push spends nothing, so a branch can take a day of commits from several threads and be reviewed once.

- Open as a draft while work continues; mark it ready when the checks are green, the diff lists only the task's files, the stills are OK'd for a taste change, and the PR body's Review section is filled. Ready is the request for the first review.
- The rolling `design-system` PR: the thread that owns it asks, once per batch, after the joining threads' commits land. A joining thread never asks.
- Before asking, read CodeRabbit's last summary comment: "N remain after this review". The hour (10 reviews) is shared by every thread in the project. At 2 or fewer, wait for the hour or run `/code-review` on the range and say so in the PR body.
- Paused or skipped: when the summary says "Reviews paused" or rate-limited and the head is unreviewed, ask with `@coderabbitai review`. Never `@coderabbitai resume`: it brings back a review per push.
- `@coderabbitai full review` only after a rebase or a squash rewrote the branch.
- Before a merge, compare `git rev-parse HEAD` with the "Last reviewed commit" in the summary. Tier 2 must match. Tier 1 may differ by fix commits for the findings only.

## What each reviewer is for

- CodeRabbit: logic, security, regressions, and the record's rules (decision format, snake_case, no em dashes). It reads `AGENTS.md` as code guidelines, so a house rule written there reaches it; `.coderabbit.yaml` carries the rules a reviewer needs spelled out (tests, motion, tokens, decisions).
- `/code-review`: the same, locally and on demand. First on Tier 2 and large diffs; the fallback whenever CodeRabbit is silent (learning 2026-10-22: review every PR locally when the bot is silent).
- `design-audit` agent: taste and design-system compliance before any UI PR. CodeRabbit does not judge taste.
- The owner: stills at 390 and 1280, light and dark, and the merge. Never asked to review code lines.
- CodeRabbit's finishing touches (docstrings, generated unit tests, autofix, fix CI, resolve conflicts) are off: they commit to a thread's branch (D254 gives the branch to the thread) and the test generator fights the test rules. The docstring pre-merge check is off; the title and description checks stay as warnings.

## Findings

Every finding gets a fix or one reply naming the rule it conflicts with (`AGENTS.md`, a D-number, a ledger line, as in #525's test reply), then its thread is resolved (the ruleset merges only with threads resolved). Do not argue twice. A finding that fights a rule on two PRs goes in the PR body's Review section; the coordinator batches those into one `.coderabbit.yaml` change.
