# Session Learnings, 2026-10-08

Source: one long working day on Singularity (news.someshks.work), about 18 pull requests, up to four parallel workers. Each entry is a mistake or a problem that really happened, what fixed it, and the rule I would add to a global instruction file. Rules are written so they can be pasted as they are.

Legend for where a rule belongs: **CLAUDE.md** (how the agent works with you), **AGENTS.md** (how agents and subagents are run), **CODE.md** (engineering practice).

---

## 1. For CLAUDE.md: working with the owner

### 1.1 Throughput: do not hold a queue behind one long check
- **What happened.** One player change waited behind a 42 minute browser suite and then a baseline comparison, while ten small notes sat untouched. You said the work was "really slow".
- **What fixed it.** Fanning each batch of notes out to a worker with its own files, and shipping each piece as its own PR the moment it was green.
- **Rule.** When more than one independent item is queued, start them in parallel at once. Never gate a queue on a check that takes longer than ten minutes; run the narrow check that covers the change and state what was not run.

### 1.2 Ship each finished piece; do not batch
- **What happened.** You asked "can we push the completed ones?" twice.
- **Rule.** A verified change is pushed as its own PR immediately. Batching is allowed only when changes share files and must be tested together, and then say so.

### 1.3 A limit nobody asked for is a bug
- **What happened.** I had built in a cap of two episodes a day. You hit it on day one: "I didn't set any explicit limits on my own."
- **Rule.** Do not add quotas, caps, cooldowns or confirmations the owner did not ask for. If a guard is needed for cost or safety, set it generously, name it in the report when it is added, and make it one constant.

### 1.4 Say when a guardrail moves
- **What happened.** I raised the first-load JavaScript budget twice (102, 103, 104 KB) to fit features you asked for.
- **Rule.** When a self-imposed limit (budget, threshold, lint rule) is loosened, say so in the same message, with the number, the reason, and the way back. Write the reason next to the constant.

### 1.5 Verify the claim, not the theory
- **What happened.** You reported "no player bar, narration is not available". The server answered correctly and a fresh browser played fine. I shipped a fix for the likely cause (a tab left open across a deploy) without reproducing it.
- **Rule.** When a reported bug cannot be reproduced, say "not reproduced", give the evidence gathered, label the fix as addressing the likely cause, and name what would confirm it. Never present an inference as a diagnosis.

### 1.6 Small usability details are the product
- **What you said.** "These minor usability aspects are the differentiating factors."
- **Rule.** For any interactive surface, check the conventions before being asked: keyboard shortcuts a media or editing app is expected to have, focus after an action, an instant response to a destructive action, no instruction text that the control makes obvious, no colour change that carries no meaning, a stable cursor.

### 1.7 Answer the question about scope with numbers
- **What happened.** "We are running out of disk space" pointed at this project. Measuring showed the project at 592 MB and one other project's temp folder at 37 GB.
- **Rule.** Before cleaning, measure and report sizes. Delete only what belongs to the current work; name the path of anything larger that belongs elsewhere and leave the decision to the owner.

### 1.8 Do not act on another party's data, even when it is the cause
- **Rule.** Folders, sessions or processes that belong to another project or session are reported with their path and size, never removed, unless the owner says so.

---

## 2. For AGENTS.md: running subagents

### 2.1 Never let a subagent delete a worktree, and never delete through a link
- **What happened.** I told a QA agent to run `git worktree remove --force`. The worktree's `node_modules` held junctions into the main checkout; the command followed them and emptied part of the main `node_modules`.
- **What fixed it.** `npm rebuild --ignore-scripts`, then `npm install --ignore-scripts`. Later, a cleanup script that walks with `lstat`, removes every link as a link first, re-walks to confirm none remain, and only then deletes.
- **Rule.** On Windows, a directory that may contain junctions or symlinks is never removed recursively. Unlink each link first (`rmdir` without `/s`), verify, then delete. Subagents never clean up worktrees; the main session does, with a script that does not follow links.

### 2.2 Workers stop at their turn cap without reporting
- **What happened.** `dispatch-worker` hit 60 turns mid-task about half the time, often with uncommitted work, and once finished with a report that never reached me.
- **Rules.**
  - Every worker brief says: commit after each step; an uncommitted change is lost.
  - When a worker stops, read its branch (`git log`, `git status` in its worktree) before anything else, then resume with "commit first, verify, report".
  - Never state what a worker did from its notification alone. If the report text did not arrive, say so and inspect the branch.

### 2.3 Give each worker disjoint files, a port, and the others' territory
- **What worked.** Briefs that listed "your files", "not yours, another worker is editing them now", and a private port. Merges were clean except where two workers legitimately touched one page.
- **Rule.** A parallel brief names: owned files, forbidden files with the reason, ports, the branch name, the checks to run and the ones not to run, a report format with a word cap, and "do not push".

### 2.4 Shared rules go in one file that every brief points to
- **What worked.** One `workers-brief.md` with the worktree fix, the commands (direct binaries, not `npx`), the budget, the commit rule. New constraints were added once and reached every worker.
- **Rule.** Put environment rules in a single brief file; task briefs reference it and add only what is specific.

### 2.5 Branches that pass alone can fail together
- **What happened.** Twice: a cover play button plus a keyboard-order test from another branch; a cache version bump plus a unit test that pinned the old version. Also the bundle size, which only exceeds the budget on the combined result.
- **Rule.** Stack parallel branches before the PR and run the whole fast suite and the size check on the stack. A worker's "all green" covers only its own branch.

### 2.6 Workers cannot run everything the main checkout can
- **What happened.** In a junction-linked worktree the dev server for the player lab would not start, so workers could not run half the player suite and said so.
- **Rule.** Know which checks only the main checkout can run, and run those there after merging. Ask workers to state what they could not run, and read that line.

### 2.7 Four builds at once make timing tests lie
- **What happened.** With four workers building, gesture and filter tests failed under load and passed alone.
- **Rule.** A failure seen only under load is rerun alone before it is fixed or blamed. Tell workers to run spec files one at a time and never a whole suite.

### 2.8 Reuse an agent while its context is useful, then start fresh
- **What happened.** Reusing the worker that built the episode menu for the next episode-page task was fast. By the third reuse its context was near half a million tokens.
- **Rule.** Reuse a worker for a follow-up in the same files. For a new area, or once its context is large, start a new one with a written brief.

### 2.9 Queue briefs when the concurrency cap is hit
- **Rule.** When no slot is free, write the full brief to a file immediately and launch it from that file when a slot opens. Do not rewrite it from memory later.

---

## 3. For CODE.md: engineering practice

### 3.1 A baseline before blaming a change
- **What happened.** Six WebKit tests failed after a player change. Stashing the change and rerunning showed the same six failing on the unchanged code.
- **Rule.** When a suite that was never fully green fails, run the same tests on the base commit before attributing anything to the change. Record known failures where the next person will see them.

### 3.2 Stale servers and stale tabs
- **What happened.** A dev server left running for hours, across a dependency repair, served mismatched React builds; every island failed with `_jsxDEV is not a function`. Separately, a tab left open across a deploy lost its lazy chunks.
- **Rules.**
  - Stop dev and preview servers when a task ends; never leave one running across an install.
  - A deployed single-page app must survive its own deploys: on a failed dynamic import, drop cached pages and reload once, but not while offline.

### 3.3 Measure what the model is asked to produce in the unit it can count
- **What happened.** Episodes asked for 5 minutes came out at 2. The writer was told a length in characters. Told in words, per story and in total, it delivered 83 to 90%.
- **Rule.** Give a language model targets in words or sentences, per part and in total, state the floor that will be rejected, and verify with real runs through a dry-run command that writes nothing.

### 3.4 Hold output to what the input can carry
- **What happened.** A 15 minute request with 12 stories cannot be filled without padding; retries asking for more only wasted calls.
- **Rule.** Compute the reachable size from the input and judge against that. Keep the best valid attempt instead of the last.

### 3.5 Tests that hard-code a policy number break when the policy moves
- **Rule.** Compute expectations from the exported constant (`COOLDOWN_MS / 1000 - 60`), never from the number it has today.

### 3.6 Background requests on page load need a test story first
- **What happened.** Prewarming audio on page open fired a request on every page of every browser test; the fixture server answered 501 and about 70 tests failed on "no console errors".
- **Rule.** Before adding a request that fires without a user action, decide how the test fixture answers it, and run the whole suite, not the specs near the change.

### 3.7 Depth limits and precache lists rot silently
- **What happened.** The service worker followed script imports three levels deep. Each new lazy import pushed a file out of the offline copy; the offline tests failed far from the cause, twice.
- **Rule.** Anything that enumerates a dependency graph to a fixed depth gets a generous depth and a test that names the mechanism. When an offline or cache test fails after an unrelated change, check the graph first.

### 3.8 Undefined CSS custom properties fail without a sound
- **What happened.** `var(--space-5)` and `var(--space-10)` did not exist. The browser dropped both declarations; two paddings were zero and nobody noticed.
- **Rule.** Enforce tokens with tests, not habit: no raw colours, durations, or lengths for spacing, type size and radius, and no `var()` of a property nothing defines.

### 3.9 Equal-specificity overrides must come after what they override
- **What happened.** A media block placed above the base rules it changed lost to them.
- **Rule.** In one stylesheet, put an override after the rule it overrides, or raise it with a layer. Check with the rendered page, not by reading.

### 3.10 The view transition overlay takes the pointer
- **What happened.** The cursor flickered to the arrow over nav links on every navigation, and presses during the transition were lost.
- **Rule.** With the View Transitions API, set `::view-transition { pointer-events: none; }` and keep a test for it.

### 3.11 Stretch a hit area in CSS before adding script
- **What worked.** Making the whole player bar open the player by stretching the open button's `::after` over the bar, with the other controls layered above. No listener, no bundle cost, correct for keyboard and screen readers.
- **Rule.** To enlarge a target, stretch the real control's pseudo-element and layer siblings above it. Remove any press transform on that control, since a transform makes it the containing block.

### 3.12 Duplicate controls: decide which one owns keyboard and assistive technology
- **What happened.** A play button over the hero cover sat next to the play chip. Keyboard users got two identical stops; a focus-ring test failed.
- **Rule.** When a pointer convenience duplicates a named control beside it, take it out of the tab order and hide it from assistive technology, and say why in a comment.

### 3.13 Short accessible-name matches are substring matches
- **What happened.** `getByRole("button", { name: "All" })` matched "Gallery view".
- **Rule.** Use `exact: true` for names under about eight characters.

### 3.14 Type checks differ; run the one CI does not
- **What happened.** `tsc` passed while `astro check` found four errors, one of them a real bug (an icon name the eager registry did not have, so it rendered nothing).
- **Rule.** Know which checks CI runs. Run the others by hand before a PR, and write that gap down so it gets closed.

### 3.15 Generated files are regenerated, not edited
- **What happened.** Icon registries and the token stylesheet are generated; changing a colour token also changed the app icons, the manifest colour and three tests.
- **Rule.** Change the source, run the generator, and expect tests that pin generated values to move. Grep for the old value before committing.

### 3.16 Windows shell habits
- **What happened.** `npx` stalled for a minute at a time; Git Bash rewrote `/settings/schedule` into a Windows path; `node -e` with nested quotes and backslashes failed; `du` would have followed junctions.
- **Rules.**
  - Call local binaries directly (`node node_modules/<pkg>/bin/...`).
  - Set `MSYS_NO_PATHCONV=1` when an argument starts with a slash.
  - Put any script with quotes, backslashes or regexes in a file; make multi-edit scripts all-or-nothing and print one success line.
  - Measure sizes with a script that uses `lstat` and never follows a link.
  - A command that times out in the foreground is usually still running; read its output file instead of starting it again.

### 3.17 Conflict resolution by rule, then by reading
- **What worked.** For "both branches added lines", a small script that keeps one side of every hunk, followed by reading what the other side had added and re-applying the part that mattered.
- **Rule.** Resolve mechanically only where the intent is obvious, then diff the losing side and confirm nothing it added was needed.

### 3.18 Dev-only tools need a build-time proof
- **What worked.** Agentation is imported only inside `if (import.meta.env.DEV)`, and the bundle check fails any build whose output mentions it.
- **Rule.** A development tool is guarded at the import and proven absent by a check on the built output.

---

## 4. Mistakes that were mine, in one list

1. Told a subagent to force-remove a worktree; it deleted part of the main `node_modules` through junctions.
2. Built a daily cap nobody asked for.
3. Ran a 42 minute suite as a gate and worked serially while a queue grew.
4. Left a dev server running for hours; it later served broken pages.
5. Put a CSS override before the rules it overrides.
6. Opened a PR with a cache version bump without running the unit test that pinned the old version; CI failed.
7. Merged a prewarm into a combined branch before running the whole suite with it.
8. Accepted a worker's "all green" for a branch whose `astro check` had not been run.
9. Raised a budget twice instead of fixing the two pages that exceed it.
10. Presented a likely cause before trying to reproduce the bug in a browser (corrected once I had).

## 5. What I would change in the instruction files, in priority order

1. **AGENTS.md:** rule 2.1 (never delete through links; subagents never clean worktrees). It is the only item here that destroyed data.
2. **CLAUDE.md:** rules 1.1 and 1.2 (parallel by default for queued items; ship each green piece).
3. **AGENTS.md:** rules 2.2 and 2.5 (inspect the branch when a worker stops; test the stack, not the branches).
4. **CODE.md:** rules 3.1, 3.6 and 3.14 (baseline before blame; whole suite for page-load requests; run the checks CI does not).
5. **CLAUDE.md:** rules 1.3 and 1.4 (no unrequested limits; announce a loosened guardrail).
