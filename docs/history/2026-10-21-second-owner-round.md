# 2026-10-21: the second owner round

Reasons: D133 to D135. Current behaviour: the player, library, settings and navigation specs.

## What was asked

Offline Play that failed, the offline banner's copy, a snackbar under the FAB, a ⋮ that moved the card, a phone bottom sheet with icons, plain outline icons, Settings in cards with About and a change log, the podcast pages reordered, a calmer slider, the Library's search and chips everywhere with a check against drift, a flat navigation control, topic emoji from Jev, Blocked sources, Other hidden, Up next as a player tab, and a calmer desktop bar press. Also: remove the weekly model check (D134), weigh a batch API (D135), advise on the open product calls, and clear every briefing and episode older than the 18 Oct weekly.

## How it was split

Five workers from `integration` (bugs and Library, settings, Sources and topics, player, batch API) and a read-only advisor; then a visual audit at phone and desktop sizes in both themes, and one fix pass for its findings. Three workers reached their 90-call cap and were resumed with what was left. The merges conflicted only in `docs/specs/settings.md`.

## What the checks caught

- Offline Play: `readerSync.ts` closed a briefing's Play whenever the device was offline, downloaded or not.
- After the merge every page was 0.5 KB over the first-load budget: the offline check imported the downloads module on every page. It now asks Cache Storage only when offline, and the topic pages' menu helper loads at idle (108.7 KB).
- The audit: a Latest icon that read as a drop, an About page without its text, a shadow on the phone FABs, a heading on its card, and smaller polish.
- A full site run failed 311 tests with connection refused: another agent stopped its own server and took the suite's with it. Run browser suites alone.

## The deletions

Eight briefings and three episodes older than the 18 Oct weekly were removed through the engine's own delete path, one run each (`run.yml` with `delete`, `podcast.yml` with a delete request). An episode delete pushed at the same moment as a briefing delete and lost: the podcast delete has no rebase-and-retry. Re-run alone, it worked.

## Advice on the open product calls

General topics stay unticked (D102); no photographs for topics yet; no More menu on built-in topics; briefings stay readouts for now; iOS startup images and the status bar wait for an iPhone pass; checking feeds for the 17 Firecrawl-listed sources is worth doing; `MAX_TEXT_CHARS` waits for measured token counts.

## Later the same day

The model orchestrator (D136), the cost ledger and /analytics (D137), Alexandria enrichment (D138), hardening (D139) and design enforcement (D140) followed, each from its own worktree, then merged as one stack.

Lessons, for learnings when it has room:
- GitHub reports two simultaneous pushes as "cannot lock ref", not "[rejected]"; the engine's rebase-and-retry only caught the second wording until D139.
- Unit tests read committed digests under `Digests/`, so the owner's cleanup broke six of them; they now read frozen copies under `packages/engine/test/fixtures/digests`.
- A worktree agent once wrote into the main checkout; brief agents to use paths relative to their worktree.
- `pkill -f <pattern>` and `pgrep -f` match the shell running them; stop a server by the PID listening on its port.
- Switching branches in a checkout while a browser suite reads it from there corrupts the run; build stacks in a separate worktree.
- A worktree made before a package install lacks it until `node scripts/worktreeLinks.mjs` runs again.
