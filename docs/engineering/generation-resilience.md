# Generation resilience

What keeps a Regenerate or a Catch up from ending in "Stopped while publishing" or shipping short, and where each guard lives (D203). Health numbers: [metrics](metrics.md).

## The 2026-10-27 failures

- A Regenerate aired 2 of 5 minutes: grounding dropped 4 of 8 stories, the refill threw on a section over its allowance, and 4 aired.
- A Catch up wrote its episode and lost it at the push: a digest run and an episode run both edited `state/costs-2026-10.json` within a second, and the rebase kept neither.

## Guards

| Guard | Where | What it stops |
| :--- | :--- | :--- |
| State merge on a rebase conflict | `git/stateMerge.ts`, `git/commit.ts` `resolveRebaseConflicts` | Cost ledger, podcast timings, usage counter and run metrics are unioned by id or run, never chosen. An unreadable file keeps the conflict and the push reports `rebase_conflict`. |
| Grounding prunes first | `validate/groundingRepair.ts` | A story with one unsupported sentence keeps its supported ones when they pass lint (`grounding_pruned`); else one rewrite and a voice repair; dropped only when nothing supported is left. |
| Allowance trim | `validate/validateDigest.ts` | A section over its allowance gives up its lowest stories (`allowance_trimmed`) instead of failing the refill. |
| Writer split retry | `write/llmWriter.ts` | A batch whose output cannot be read is written again in halves with more room. |
| Failure reason | `podcast/failureReason.ts` | The status route sends a plain sentence for a failed Catch up (`reason`), shown in the run card. |
| Slot filling | `podcast/structure.ts` `fitStories` | A Catch up selects half again as many stories as it airs and fills its slots after the structure's caps. |

## Speed

Voice rewrites run four stories at once, grounding eight, and `podcast.yml` installs no ffmpeg (the audio job does). Target: a briefing under 4 minutes, an episode under 3.

## Known behaviour

- A failed run's record commit (`--record-failed`) stages whatever the working tree changed inside the write guard's allowlist, as it always did for a scheduled run and now does for an on-demand one (its spend and metrics ride in it). If the Commit step wrote a digest and then failed before its own commit, the record commit carries that digest and the card says failed. The content is not lost; the report is.
- A Regenerate's Length sizes the fetch and write steps, the section counts of the write, validate and commit steps (`loadSectionPlan(..., asked)`), and nothing else: the narration limit and the digest's hard maximum still hold.
