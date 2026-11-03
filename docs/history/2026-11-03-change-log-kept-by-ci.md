# The change log kept by CI

2026-11-03. Thread: PR rules. Decision D355.

## What was wrong

- `lib/changelog.ts` (the Change log page and the app's version) stopped at 0.9.1 on 23 Oct. About 390 pull requests merged over the next 11 days.
- Its one rule was a comment at the top of the file. AGENTS.md, the feature skill and CI never named it, so no PR was ever asked for an entry.

## What changed

- Entries 0.10 to 0.19, one a day from 24 Oct to 3 Nov, written from the merged PR titles in plain words.
- The docs check fails a `feat`, `fix` or `perf` PR while the newest entry is more than two days old. The first PR after a gap writes the missing days; the others merge main. `PR_TITLE="fix: x" node scripts/docsCheck.mjs` runs it locally.
- Not chosen: a required entry in every PR. Thirty to forty PRs a day would edit the same lines of one file and conflict on each merge.
