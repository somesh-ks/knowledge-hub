# Spend limits and the coverage reading

2026-11-02 to 11-03. Thread: the weekly-run and half-built audit (H7, M4, M11). Decision D339.

## What was wrong

- Speechify had two counts. The engine stopped at 90 percent of `state/usage.json`, the site at 90 percent of its own Blob document, so the two together could pass the plan's cap.
- Exa had no stop at all; Firecrawl's weekly stop (D222) had no twin.
- The coverage step in `health.yml` failed in 0 s with `config/` missing, and `continue-on-error` hid it. Its table went to the run's summary, which no session can read.
- A failed Regenerate never reached the cost ledger: `run.yml` skipped "Record failure" when `inputs.replace` was set.

## What changed

- The engine reads and adds to the site's `state/usage-<month>.json` (D339). Writes carry the ETag they read and retry on a lost race; the first write of a month only creates. The month's characters left in `state/usage.json` are still counted by the engine's gate and health.
- Exa stops at 700 requests a week, read from the cost ledger; a ledger that does not read gives Exa no room.
- The coverage step loads config from the store and prints into the log as well as the summary. A failed Regenerate records its spend and keeps `state/seen.json` as it was.

## Proof

- 11-02 23:47 scheduled run: Haiku daily, 12 stories, length share 1.04, no fallback, run cost about 11 cents; audio wrote 5,517 characters with the Blob counter and stayed green.
- 11-03 coverage: held 76 percent (rss 18 of 19, Exa 0 of 5), read 93 percent, shadow exit not met. The store holds no Exa story.

## Left

The site's own write is not version-checked, and its gate does not count the engine's old file count (November only). The podcast script on Haiku has not run yet. H2 (job split) and M3 (trusted publishers) wait on the owner.
