# Docs

Where each kind of fact lives. Each fact is kept in one place; the others link to it. Code, tests and git history are the source for anything they express; these files hold only what they cannot.

| File | Holds | When to read |
| :--- | :--- | :--- |
| [state.md](state.md) | What works, what is unverified (each with `closed when:`), risks, next | Every session |
| [backlog.md](backlog.md) | Long-term memory, future ideas, parked tasks, and shipped milestones | Before planning new features or offloading cold tasks |
| [decisions/](decisions/README.md) | Every decision, D1 onward: the Index, and one file per area | For the reason behind a choice |
| [learnings.md](learnings.md) | Gotchas by area, one line each | Before debugging |
| [specs/README.md](specs/README.md) | What each capability does now, one spec each | Before changing a capability you do not know |
| [design-engineering-ledger.md](design-engineering-ledger.md) | The owner's taste and how to work with them: the core of the ledger | Before UI work |
| [ledger/](ledger/README.md) | The ledger by surface (one file each), the code's gaps and open asks, ideas not built | After the core, for the surface you touch |
| [design/sound-design.md](design/sound-design.md) | The sound system: recipes, levels and rules | Before changing a sound |
| [design/podcast-structure.md](design/podcast-structure.md) | The modular script structure for every episode kind, with the owner's answers (D170, accepted, not built) | Before building the Preferences structure view |
| [runbook.md](runbook.md) | Owner setup and operation | Setup, secrets, a broken deploy |
| [engineering/delivery-failures.md](engineering/delivery-failures.md) | Why PRs, CI and deploys failed, and the rules that stop each one | Before pushing, and when a check is red |
| [engineering/first-load-js.md](engineering/first-load-js.md) | First-load JavaScript per page and the cuts | Before adding first-load code |
| [engineering/engagement-and-share-plan.md](engineering/engagement-and-share-plan.md) | Share links and the listen page on top of Simple Analytics (D154), in stages (D153) | Before building engagement or sharing |
| [engineering/metrics.md](engineering/metrics.md) | The generation health metrics, their targets, where each is measured and the 2026-10-27 baseline | Before changing generation, and when `singularity metrics` or `health` flags a trend |
| [engineering/generation-resilience.md](engineering/generation-resilience.md) | The guards that keep a Regenerate or Catch up from failing or shipping short (D204) | Before changing validation, the writer or the push |
| [engineering/pnpm-migration.md](engineering/pnpm-migration.md) | A pnpm spike: what worked, the five changes it needs, and what only CI and Vercel can check (D206) | Before moving to pnpm |
| [engineering/hardening.md](engineering/hardening.md) | Silent faults by aspect, the `health` detector, self-healing, what is left | When a fault slips past, or before adding a monitor |
| [engineering/postmortem-test-suite.md](engineering/postmortem-test-suite.md) | How the test suite grew past its use | Before changing a test |
| [engineering/reliability-audit-2026-10-15.md](engineering/reliability-audit-2026-10-15.md) | What failed inside the server's edit gap; risks left open | Before changing config saves |
| [engineering/stylex-pilot-evaluation.md](engineering/stylex-pilot-evaluation.md) | StyleX pilot benchmark and trade-offs for React player islands | Before introducing CSS-in-JS or changing player styles |
| [reference/sources-reference.md](reference/sources-reference.md) | Sources outside the pipeline, and rejected candidates | Before adding a source |
| [reference/resources.md](reference/resources.md) | Curated design-engineering and AI resources | When asked for references |
| [history/](history/README.md) | One note per session: why something was done | Only for the why behind a change |
| [prototype/](prototype/) | Generated prototype pages and the sound lab (built by `scripts/`) | Rarely |
| [design/command-center.md](design/command-center.md) | The admin dashboard as its own app: decisions, phases, risks (D224) | Before touching `apps/admin` or an admin page |
| [design/data-off-the-deploy-path.md](design/data-off-the-deploy-path.md) | Content in Blob rendered on demand, builds for code only (D173) | Before touching the content store, a page that shows content, or `ignoreCommand` |

The first build's plan, vision and UI spec (`plan/build-plan.md`, `plan/vision.md`, `design/design-spec.md`) were retired on 2026-10-19; later decisions had overridden most of them. Read them with `git show 91bc533:docs/<path>`.
