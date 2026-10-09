# 2026-10-10: Podcast settings, providers, voices and the player redesign

One long session, about 25 pull requests, up to four workers at a time. Current facts are in [state.md](../state.md); the decision is D49.

## What changed and why
- Bisected the two player regressions of 2026-10-08 (#31 removed the Generate row a test used; #32 put the hero cover under the open header). Fixed with #42.
- Create panel simplified (#44); Anthropic as a second writer (#52); source score and preview (#53); schedule profiles with weekly and voices (#55); voices (#57); hosts named (#49); Settings notes (#56, #50); lab pages out of production (#51).
- Settings redesign from the owner's notes: one Podcast page and a clubbed Topics & sources page with scores and an Add source panel (#58, #59). The player redesign (#47) is a draft.
- Lint, secrets and worktrees: #46 (Biome skips `state/`), #45 (the secrets push showed why it failed), ten stale worktrees removed with an lstat-based unlink script.

## What went wrong
- A verification ran on the wrong branch (`git checkout --autostash` is not a flag); caught by reading the branch list.
- A stale test server failed a whole suite on a new route.
- Every worker stopped at its 60 turn cap at least once; resuming with "commit first, verify, report" worked each time.
- The service worker's reference patterns missed backtick imports, which pushed the briefing script out of the offline copy.

## Owner steps left
See "Next" in state.md: the two workflow edits, the dead `VERCEL_TOKEN`, and "merge" for #47.
