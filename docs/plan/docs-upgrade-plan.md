# Docs upgrade plan (2026-10-19)

Goal: an agent starts a session on a quarter of today's tokens, finds current behaviour in one place, and a check, not memory, keeps the record honest. Source: the owner's review of an outside framework plan (ADR, Divio, C4, RFC, OpenSpec) on 2026-10-19.

## Baseline (measured 2026-10-19)

| File | Size | Read when |
| :--- | :--- | :--- |
| `AGENTS.md` | 6.6 KB | every session |
| `docs/state.md` | 65 KB | every session |
| `docs/learnings.md` | 67 KB | listed as read-first |
| `docs/decisions.md` Index | 16.5 KB (whole file 234 KB) | every session |
| Total read-first | about 155 KB, about 39k tokens | |

Cause: `state.md` has become a log. Its top 47 lines are dated session paragraphs, and "Working in production" is a full behaviour spec of every surface. Nothing enforces "rewritten, never appended".

Target: read-first (`AGENTS.md`, `state.md` and the decisions Index) at most 40 KB (about 10k tokens), enforced by the gate. The Index grows about 130 bytes a decision, so the budget holds it too.

## Shape after the change

| File | Holds | Budget |
| :--- | :--- | :--- |
| `AGENTS.md` | Rules, commands, the read-first list | 7 KB |
| `docs/state.md` | Now: what works (one line each, linked to a spec), unverified (each with `closed when:`), risks, next | 12 KB |
| `docs/specs/<capability>.md` | Current behaviour of one capability, OpenSpec-style requirements and scenarios, plus its code paths | 8 KB each, read on demand |
| `docs/specs/README.md` | Capability map: spec, packages, entry points (replaces the outside plan's `modules.md`) | 4 KB |
| `docs/decisions.md` | Unchanged entries; header gains two conventions; Index searched, not read | entries 1.5 KB each |
| `docs/learnings.md` | Gotchas still in force, under area headings | 25 KB, searched |
| `docs/history/` | Session notes, and the dated paragraphs moved out of state | no budget |

Specs replace the long behaviour bullets, so state stops repeating them. The schema stays in code: `packages/core/src/digest.ts` is the source, and the digest spec links to it.

## Milestones

### PR 1: the check and the conventions (about 2 hours)

1. `scripts/docsCheck.mjs`, run as a fifth chain in `scripts/gate.mjs`. Checks:
   - byte budgets in the table above (state, AGENTS, each spec, learnings);
   - every relative link in `AGENTS.md` and `docs/**/*.md` resolves;
   - Index rows and `## Dn` entries match one to one; a `superseded by Dn` names an existing D;
   - every bullet under state's Unverified heading contains `closed when:`;
   - every file in `docs/` is listed in `docs/README.md` (`history/` and `prototype/` keep their own index);
   - `houseRules.test.ts` covers `docs/specs` for dashes.
   - It prints the read-first total in KB and tokens (bytes / 4) on every run.
2. A unit test with three frozen fixtures: an over-budget file, a broken link and an orphan Index row. Each must fail with its own line. Per the Tests rules, it names the bug: "the record drifts and nobody sees it".
3. `decisions.md` header: a superseding entry adds `Context changed:` (one sentence); an entry whose reason can expire adds `Revisit if:`. New entries only; no backfill.
4. `.github/pull_request_template.md`: What changed; Specs touched; Open items closed and opened (with `closed when:`); Shared files and why. It is not a workflow file, so auto-merge still works.
5. `.claude/skills/close-session/SKILL.md`: add three steps (update the spec of any changed behaviour; give each new unverified line a `closed when:`; run `node scripts/docsCheck.mjs`).
6. `AGENTS.md` read-first: state, then "grep the decisions Index", then "search learnings before debugging", then "read the spec of the capability you touch".

The check lands in warn mode (prints and exits 0) until PR 2 brings the files under budget, then switches to fail.

### PR 2: the content move (about half a day)

1. Write `docs/specs/` from state's "Working in production": player, library, create (episodes), settings (schedule, topics and sources, autosave), engine (fetch, judge, write, validate), narration and audio, offline and service worker, sound. Each spec contains requirements in plain present tense, `Scenario:` bullets only where behaviour has edge cases, the D-numbers it rests on, and code paths. No history.
2. Rewrite `state.md`: one line per working capability linked to its spec, Unverified with `closed when:` on every line, Known risks, Next. Move the dated paragraphs (lines 3 to 47) into the history notes for their days. Most of these notes already exist; add a note only where none does.
3. `learnings.md`: group under headings (Browser tests, Engine and workflows, Build and tooling, Windows, Agents and worktrees). Move lines already enforced by code, an agent file or `AGENTS.md` to `docs/history/learnings-archive.md`, each with a pointer to what enforces it.
4. `docs/runbook.md`: add a "Site trouble" section of symptom, cause and fix for the deployed reader (Cron 503, narration unavailable, `vercel link` failure, settings 429). Development failures stay in learnings.
5. Switch the check to fail mode.

Fact safety: move text, do not delete it. Before merging, the `reviewer` agent compares the old `state.md` with the new state, specs and history notes and lists any fact that is now missing.

## Not adopted, and why

- OpenSpec's CLI and `changes/` folder: a PR with its decision entry is already the change proposal, and the CLI adds a dependency and slash commands for one owner.
- `docs/reference/schema.md`: it would duplicate `digest.ts`, which is authoritative and typed.
- Tag prefixes and a Trigger column: backfill cost on files that are searched, not scanned; area headings do the same job for learnings.
- A C4 diagram and per-file ADRs: diagrams rot, and one indexed file is cheaper for an agent than 123 files.

## Verify

- `npm run gate -- --build` passes, with the docs check in fail mode.
- The check reports read-first at 40 KB or less.
- The reviewer's fact-coverage list is empty or resolved.
- A fresh session, given "what does the player do on Back?", answers from `docs/specs/player.md` without opening `decisions.md`.

## Reassess when

The read-first total creeps past 40 KB twice in a month, or an agent misses a behaviour that a spec held. Either means the budget or the spec split is wrong.
