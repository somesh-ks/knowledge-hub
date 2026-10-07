# State

Last updated 2026-10-07. Rewrite this file; do not append.

## Working

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius Qwen3 235B), validate, commit as the owner.
- First digest `2026-10-06` committed and deployed by Vercel (Git integration, Hobby accepts the owner identity).
- CI on Linux: typecheck, lint, tests, site build, gitleaks. Auto-merge for owner and Dependabot PRs (PR #4).
- GitHub secrets and variables are set from `.env`; Vercel has the Generate button variables.

## Not working or unverified

- Audio: no digest has audio yet. With a valid `VERCEL_TOKEN` the `audio.yml` run reaches `vercel link` and the env pull, then fails at the write guard (`.gitignore`). A fix PR runs the CLI in a scratch directory and ignores the `[SENSITIVE]` placeholder; it needs a manual merge. Speechify and the Blob upload are still unverified (D26). `dispatch doctor --online` now checks the token (`online.vercel`) and confirms Speechify and voice `geffen_32` work; run it before rerunning the workflow. The reader shows "Audio is still being prepared" until a run succeeds.
- Generate button and passphrase are untested against the live site.
- Curation: half of the first digest was GitHub patch releases; needs grouping and down-weighting.
- Extra Blob store `store_JmrDq8MB5Kwn3ejW` is empty and should be deleted (keep `store_IRMb7o0QWTVEacJt`).
- Not tested on a real iPhone (lock-screen controls, silent switch, sounds).

## Known risks (audit 2026-10-07, not fixed)

- A failed Blob upload loses the paid narration and the next daily run pays for it again, for up to 7 days.
- `publish` writes the timeline before the digest; a failure between them shows "The audio has expired" for a digest never narrated.
- `markSeen` records every judged id, so items cut by the digest cap are hidden for 90 days.
- The Generate passphrase check has no attempt limit before the cooldown applies.
- Missing Speechify credentials leave `publish` green with audio still null (D23).
- Dependabot merges may fail on a read-only `workflow_run` token; the merge-by-hand notice still prints.

## Next

1. Merge PR #5, run a digest, confirm audio plays.
2. Test Generate against the live site.
3. Tune release-note noise in prefilter and score.
