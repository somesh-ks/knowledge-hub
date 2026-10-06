# State

Last updated 2026-10-06. Rewrite this file; do not append.

## Working

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius Qwen3 235B), validate, commit as the owner.
- First digest `2026-10-06` committed and deployed by Vercel (Git integration, Hobby accepts the owner identity).
- CI on Linux: typecheck, lint, tests, site build, gitleaks. Auto-merge for owner and Dependabot PRs (PR #4).
- GitHub secrets and variables are set from `.env`; Vercel has the Generate button variables.

## Not working or unverified

- Audio: no digest has audio yet. PR #5 switches uploads to Blob OIDC; unverified (D26).
- `news.someshks.work` has no DNS record: add `A news` to `76.76.21.21`, proxy off.
- Generate button and passphrase are untested against the live site.
- Curation: half of the first digest was GitHub patch releases; needs grouping and down-weighting.
- Extra Blob store `store_JmrDq8MB5Kwn3ejW` is empty and should be deleted (keep `store_IRMb7o0QWTVEacJt`).
- Not tested on a real iPhone (lock-screen controls, silent switch, sounds).

## Next

1. Merge PR #5, run a digest, confirm audio plays.
2. DNS, then test Generate.
3. Tune release-note noise in prefilter and score.
