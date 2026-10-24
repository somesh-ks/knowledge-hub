# Delivery failures

Why pull requests, CI, builds and deployments failed from 2026-10-15 to 2026-10-22, and the rule that stops each one coming back. Written 2026-10-22 after the owner asked for it. Evidence is the run or deployment named; "inferred" marks what no log states. Add a row when a new kind of failure appears; do not repeat one that is here.

## The rules

1. **One push per PR, after the checks pass locally.** `npm run gate -- --build`, both browser suites for site changes, and Biome on the touched files in a worktree (`npm run lint` checks nothing there). Every push to an open PR cancels the last CI run and starts a new one, and both are billed (classes 1, 4, 5).
2. **A preview deploys only from a branch named `preview/*`.** Any other branch, the agents' included, gets no Vercel preview and no Neon branch (class 2).
3. **Merge `main` into an open branch after `main` changes `apps/web/vercel.json` or a workflow.** Vercel and Actions read those files from the branch's own commit, so an old branch keeps the old rules (class 2).
4. **A red check is classified before anyone acts on it:** billing, Vercel branch limit, a cancelled run, an ignored build, a known flake, or a real failure. Only the last needs a code change (classes 1 to 6).
5. **Never remove a worktree or branch another session made.** A worktree with no commits looks merged and is someone's work in progress (class 8).

## Failure classes

| # | What showed | Cause | Status | Stops it |
| :--- | :--- | :--- | :--- | :--- |
| 1 | About 17 runs red in 2 s on 2026-10-22, 05:42 to 08:10 UTC, PRs and `main` alike (e.g. run 39745559710): "The job was not started because recent account payments have failed or your spending limit needs to be increased" | The private repo used up its Actions minutes: CI about 880 minutes a week (a full run billed 25, 19 of them the browser job), episode eval 290, and CI ran again on every push to `main` | Spend cut by D148 (#190): CI on pull requests only, the browser job by path or label. No alarm before the cap | Rule 1; count review and eval minutes in the budget; a minutes check in `health` (follow-up) |
| 2 | Every Vercel preview in Error within 2 s, no build log (e.g. on #205, #207, #209) | Neon's Vercel integration makes a database branch per preview; the free plan's branch limit filled with agent branches (`claude/*`, `worktree-agent-*`). Learnings already had this on 2026-10-22 | Fixed by #215: `git.deploymentEnabled` in `apps/web/vercel.json` allows `main` and `preview/*` only. Open: branches cut before #215 still fail until rule 3; `branches.yml`'s Neon cleanup needs `NEON_API_KEY` and `NEON_PROJECT_ID`, which are not GitHub secrets (checked 2026-10-22) | Rules 2 and 3; set the two secrets |
| 3 | Vercel "Canceled" after 2 to 3 s | `ignoreCommand` found no change the site reads, so the build is skipped | Working as intended | Read it as a pass |
| 4 | About 30 CI runs "cancelled" | `cancel-in-progress` in `ci.yml`: a newer push replaces the run | Intended; each still bills | Rule 1 |
| 5 | About 18 real failures, each fixed by a later push: `design-check` (#216), a fractional padding on `select.manage-input` against the 4px grid (#213), two Library menu specs, an eval import of a renamed module | Code pushed before the local checks | Fixed | Rule 1 |
| 6 | Flakes: the sound test "scales the rendered peak with the master volume" (2026-10-15, 2026-10-22 on #216, 2026-10-24 on #237); a Chrome for Testing download in CI (2026-10-21) | A Node 24 V8 bug: the first render read the second's peak ([learnings](../learnings.md), [history](../history/2026-10-24-sound-test-and-a-v8-bug.md)); a network failure | Sound fixed on 2026-10-24: `render.ts` keeps its loops out of the functions that return objects. Download open | Cache Playwright browsers in CI |
| 7 | Red workflow runs that are not code faults: `config` exits 1 on "Already a source" (a repeated `source.add`, 2026-10-19 and 20); a health drill (fixed by #196, #204); podcast run 39652030348 (cause not found) | An expected refusal reported as a failure | Open but `health` | `singularity config apply` treats an existing source as done |
| 8 | Local: this session's worktree removed mid-task (2026-10-22, also `settings-ui-refinements-676801` the same day) | Another session's cleanup took a clean worktree whose branch sat on `main` for merged | Recovered by hand | Rule 5 |
| 9 | Local: the browser suites cannot start ("Executable doesn't exist ... chromium_headless_shell-1248") | Playwright was bumped to 1.64.1; the machine has Chromium 1243 | Worked around with an untracked config; open | After a Playwright bump, `npx playwright install chromium` |
| 10 | Next: `docsCheck` fails any PR that adds a decision row (read-first 40.0 of 40 KB on 2026-10-22) | Every decision adds an Index row; the budget has no room left | Open | The owner raises the budget or the Index rows move out of read-first |

## The merge flow, as designed (not failures)

Every PR carries `review`, so it merges by hand after the review lands (D143); `automerge` merges Dependabot only. A PR that edits `.github/workflows` needs a manual merge (the token cannot). `browser` reads "skipping" or "pending" unless the PR touches the player, the shared stylesheets or the tokens, or carries the `browser` label (D148).
