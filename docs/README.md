# Docs

Where each kind of fact lives. Each fact is kept in one place; the others link to it.

## The record (read first, kept current)

| File | Holds | How it changes |
| :--- | :--- | :--- |
| [state.md](state.md) | What works, what is broken, what is next | Rewritten each session |
| [decisions.md](decisions.md) | Every decision, D1 onward, with an Index table | One entry per change of direction |
| [learnings.md](learnings.md) | Failures and gotchas, one line each | Appended |
| [history/](history/README.md) | One note per session: why something was done, including the 2026-10-11 audits | One note per session |

## Design

| File | Holds |
| :--- | :--- |
| [design-engineering-ledger.md](design-engineering-ledger.md) | The owner's taste, how to work on UI here, every design ask and fix by surface, reusable mechanisms, gaps, open asks, and the queue for the design-engineering skill. Read before UI work. |
| [design/design-spec.md](design/design-spec.md) | The first prototype's UI specification; the look has since moved on (D31, D72), and the ledger records how |
| [design/sound-design.md](design/sound-design.md) | The sound system: recipes, levels and rules |
| [prototype/](prototype/) | Generated prototype pages and the sound lab (built by `scripts/`) |

## Plan and engineering

| File | Holds |
| :--- | :--- |
| [plan/vision.md](plan/vision.md) | The original vision, the digest schema and the taste model |
| [plan/build-plan.md](plan/build-plan.md) | The first build's architecture and as-built record; later decisions override it |
| [engineering/first-load-js.md](engineering/first-load-js.md) | First-load JavaScript per page, where the bytes are, and the cuts |
| [engineering/postmortem-test-suite.md](engineering/postmortem-test-suite.md) | How the test suite grew past its use; read before changing a test |
| [runbook.md](runbook.md) | Owner setup and day-to-day operation |

## Reference

| File | Holds |
| :--- | :--- |
| [reference/resources.md](reference/resources.md) | Curated design-engineering and AI resources |
| [reference/sources-reference.md](reference/sources-reference.md) | Sources outside the automated pipeline, and rejected candidates |
