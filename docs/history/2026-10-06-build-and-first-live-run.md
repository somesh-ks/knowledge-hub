# 2026-10-06: Build and first live run

**Goal:** a private, automated design-engineering briefing with audio, deployed to news.someshks.work.

## Shipped

- Monorepo: core, engine, cover, sound, web (PR #1). Skills `digest`, `learn` in the repo; `sk-dispatch` outside it.
- CI, then Vercel Git-integration deploys (D25), owner-authored commits.
- First live digest `2026-10-06` (10 items). Auto-merge (PR #4), Blob OIDC (PR #5).

## Decisions

D19 to D27 in [decisions.md](../decisions.md).

## Failures

All in [learnings.md](../learnings.md): cli.ts mode change, Hobby commit author, hidden Blob token, token scope, `.gitignore` append, classifier blocks.

## Tried and dropped

- Vercel CLI deploy from Actions: needed three secrets and a token; replaced by the Git integration.
- Writer bake-off on six models: declined to spend; chose Qwen3 235B (primary) and Nemotron 3.5 Lightning (fallback) from price and docs. Unverified.
- Cloudflare R2 for audio: kept as the fallback if OIDC upload fails.
- Long-lived Blob token: unobtainable (hidden).

## Open

See [state.md](../state.md).
