# Dispatch

Private design-engineering news briefing. A GitHub Actions engine writes a digest every second day, commits it under `Digests/`, and Vercel deploys the reader at news.someshks.work. Repo: somesh-ks/knowledge-hub.

## Read first

1. [docs/state.md](docs/state.md): what works, what is broken, what is next. Rewritten, never appended.
2. [docs/decisions.md](docs/decisions.md): read the Index table; open an entry only when you need its reasoning.
3. [docs/learnings.md](docs/learnings.md): failures and gotchas. Search it before debugging.
4. [docs/history/](docs/history/README.md): one note per session, only for the why behind a change.

[docs/build-plan.md](docs/build-plan.md) is the design; [docs/runbook.md](docs/runbook.md) is owner setup.

## Commands

- `npm run dispatch -- <command>`: engine CLI (`doctor`, `status`, `models`, `run`, `publish`).
- `npm test`, `npm run typecheck`, `npm run lint`: all must pass.
- `DISPATCH_STATIC_ONLY=1 npm run build`: local site build (the Vercel adapter fails on Windows symlinks).

## Rules

- Never read, print or ask for key values. Keys live in the gitignored `.env`; `npm run secrets:push` sends them to GitHub and Vercel.
- Commits are Conventional Commits. Digest, state and config commits go through the write guard.
- No em dashes. Persisted data is snake_case; docs and config files are lowercase kebab-case.
- Do not edit `Digests/` or `state/` by hand.
- Changes to `.github/workflows` need a manual merge (the auto-merge token cannot merge them).
- TypeScript stays on 6.x.

## Keeping the record

At the end of a session: update `docs/state.md`, add a decision (next D-number, and a row in the Index) for anything that changes direction, add one line to `docs/learnings.md` per failure, and add a note under `docs/history/`. Keep each fact in one place and link to it.
