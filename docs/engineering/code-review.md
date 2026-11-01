# Code review

How a pull request is reviewed, by whom, and when (D143, D192, D254, D292). The decision holds the why; this page is the procedure. The reviewer is CodeRabbit at both ends: its CLI on the branch before a push, its app on the PR when the PR is ready. `/code-review` is retired (the owner, 2026-11-01: useless and a waste of tokens).

## The tier decides the review

The highest tier of any changed file is the PR's tier. `git diff --stat origin/main...HEAD` lists the files (the three dots: against the merge base, so commits that landed on `main` since the branch left it do not raise the tier).

| Tier | Files | Review |
| :--- | :--- | :--- |
| 0, none | Every file under `docs/` but not `decisions/`, `engineering/`, `design/` or the design ledger; test data or fixtures; a typo or copy fix of a few lines in code outside the Tier 2 set | `[skip-review]` in the title; merge on green CI (D254) |
| 1, one review | Everything not in Tier 0 or 2: pages, scripts, styles, tests, `scripts/`, docs that hold rules (`docs/decisions/`, `docs/engineering/`, `docs/design/`, the ledger) | `cr review` before each push; CodeRabbit on the PR once, when it is ready. Fix or answer each finding. Fix commits merge on green; new logic after the review is asked for again |
| 2, full review | The pipeline (`packages/engine`), the store (Blob, Neon, the config store), auth, billing, `.github/workflows`, the design system's shared files (`tokens/`, `apps/web/src/design-system/`, `primitives.css`, `buttons.css`, `player.css`), `AGENTS.md`, `.coderabbit.yaml`, the gates under `scripts/` | `cr review --deep` before each push; CodeRabbit on the PR when ready; `@coderabbitai review` after the fixes; merge only when CodeRabbit's "Last reviewed commit" is the head |

## The CLI before the push

The CodeRabbit CLI reviews the branch where it is, with the repository's `.coderabbit.yaml` and the organization's learnings, and draws on its own allowance: on the Advanced plan 10 CLI reviews an hour per developer, separate from the 10 PR reviews an hour. A pass before the push costs the PR pool nothing, so the PR review mostly confirms and needs one round.

```
cr review --base main --committed            # Tier 1: the branch's commits against main
cr review --base main --committed --deep     # Tier 2: the PR review's full capability policy
cr review --base main --committed --agent --gate major   # exit 2 when a major or worse finding remains
```

- Once per batch, after the checks are green and before the push. Fix or answer each finding; a finding answered with a rule goes in the PR body's Review section. Push when `--gate major` exits 0 or every remaining major finding is answered there.
- Every thread shares the owner's seat, so the CLI pool is shared too (`cr review --usage` shows it). At 2 or fewer left, push without the pass and say so in the PR body; the PR review still runs.
- The CLI refuses a comparison of 300 or more files: split the batch or narrow with `--base-commit`.
- Setup: an Agentic API key from the owner's seat (CodeRabbit app, Settings, API Keys) in `CODERABBIT_API_KEY`; `coderabbit auth login --api-key "$CODERABBIT_API_KEY"` once per machine, or `--api-key` on the review. The cloud environment installs the binary in its setup script (`curl -fsSL https://cli.coderabbit.ai/install.sh | CI=1 sh`) and holds the key as a secret; the owner's machine installs with `irm https://cli.coderabbit.ai/install.ps1 | iex` and signs in with `coderabbit auth login`. Usage-based billing stays off, or capped: an over-limit review costs $0.25 a file.
- No CLI (no key, binary refused): push, and the PR review is the only pass. Say so in the PR body.

## A review is asked for, never fired by a push

`.coderabbit.yaml` sets `auto_incremental_review: false`: CodeRabbit reviews a PR when it opens, and after that only on `@coderabbitai review`. A draft gets no review, and marking it ready starts none (CodeRabbit skips that event). A push spends nothing, so a branch can take a day of commits from several threads and be reviewed once. A PR whose files `path_filters` all exclude (a lockfile bump) gets no review from either end: Dependabot's merges on green CI (`automerge.yml`), anyone else's is Tier 0 by construction.

- Open as a draft while work continues; mark it ready when the checks are green, the diff lists only the task's files, the stills are OK'd for a taste change, and the PR body's Review section is filled. Then post `@coderabbitai review`: that is the first review.
- The rolling `design-system` PR: the thread that owns it asks, once per batch, after the joining threads' commits land. A joining thread never asks.
- Before asking, read CodeRabbit's last summary comment: "N remain after this review". The hour (10 reviews) is shared by every thread in the project. At 2 or fewer, wait for the hour or run `/code-review` on the range and say so in the PR body.
- Paused or skipped: when the summary says "Reviews paused" or rate-limited and the head is unreviewed, ask with `@coderabbitai review`; while the PR pool is out, a `cr review` pass on the range stands in, and the PR body says so. Never `@coderabbitai resume`: it brings back a review per push.
- `@coderabbitai full review` only after a rebase or a squash rewrote the branch.
- Before a merge, compare `git rev-parse HEAD` with the "Last reviewed commit" in the summary. Tier 2 must match. Tier 1 may differ by fix commits for the findings only.

## What each reviewer is for

- CodeRabbit on the PR: logic, security, regressions, and the record's rules (decision format, snake_case, no em dashes), with the PR's description and threads as context, and a record on the PR the owner reads before the merge. It reads `AGENTS.md` as code guidelines, so a house rule written there reaches it; `.coderabbit.yaml` carries the rules a reviewer needs spelled out (tests, motion, tokens, decisions).
- The CodeRabbit CLI on the branch: the same reviewer before the push, from its own allowance. Also the fallback whenever the PR review is paused or out of reviews (learning 2026-10-22: review locally when the bot is silent).
- `design-audit` agent: taste and design-system compliance before any UI PR. CodeRabbit does not judge taste.
- The owner: stills at 390 and 1280, light and dark, and the merge. Never asked to review code lines.
- CodeRabbit's finishing touches (docstrings, generated unit tests, autofix, fix CI, resolve conflicts) are off: they commit to a thread's branch (D254 gives the branch to the thread) and the test generator fights the test rules. The docstring pre-merge check is off; the title and description checks stay as warnings.

## A second opinion, on demand

A second reviewer pays only where the two fail differently. CodeRabbit is strongest on the diff and the rules it is given; Greptile indexes the whole repository, so its edge is the change that breaks a consumer elsewhere. Greptile stays off automatically (`autoReview` empty in its config, so the `[skip-review]` keyword never matters to it) and is asked by comment:

- When: a Tier 2 PR, after CodeRabbit's pass and the fixes; or any PR whose CodeRabbit summary rates merge risk moderate or higher, or whose `npm run blast-radius` lists three or more consumer surfaces. Never the rolling `design-system` PR (taste is `design-audit`'s), never Tier 0 or a plain Tier 1.
- How: the thread that owns the PR posts `@greptileai` once (`@greptileai review this at plus` for a Tier 2 diff over about 400 lines). Its findings get the same fix-or-reply as CodeRabbit's; where the two disagree, the thread decides and says so in the Review section. A 👎 on a finding that fights a house rule trains it.
- Budget: the Starter plan is free for one developer with 50 credits a month (Base 1, Plus 3, Apex 10). Every thread spends the owner's credits; at 10 or fewer left, Tier 2 only.
- Reassess after five uses: keep it only if at least one found a real defect CodeRabbit missed.

## Findings

Every finding gets a fix or one reply naming the rule it conflicts with (`AGENTS.md`, a D-number, a ledger line, as in #525's test reply), then its thread is resolved (the ruleset merges only with threads resolved). Do not argue twice. A finding that fights a rule on two PRs goes in the PR body's Review section; the coordinator batches those into one `.coderabbit.yaml` change.
