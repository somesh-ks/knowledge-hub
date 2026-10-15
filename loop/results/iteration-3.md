# Iteration 3: let length, not the 18-story cap, size the weekly (L2). Reverted

Change tried: a briefing sized by `total` is no longer held to its kind's count cap (12, weekly 18).

| Episode | Metric | Iteration 2 | Iteration 3 |
|---|---|---|---|
| replay-daily | length (script) | 5.1 of 5 min PASS | 5.1 of 5 min PASS |
| replay-weekly | length (script) | 9.3 of 15 min FAIL | 14.4 of 15 min PASS |
| replay-weekly | topics covered | 10 of 13 | 10 of 13 |

Reverted: three pipeline tests failed (`general-pipeline.test.ts` ×2, `orchestrator-pipeline.test.ts`
Sunday run) because `validateDigest` (`validate/validateDigest.ts:133`) and agent-mode curation
(`curate/agentMode.ts:106`) still enforce 12 and 18 outside the own sections. In production the
15-minute weekly would fail validation and not publish. Fixing L2 means making those two checks
follow the length too, which edits their existing tests: the owner's call.

The weekly it would make: 40 stories, 11 of them `developer_tool_launches`. This is I3 in numbers:
filling 15 minutes from a normal week's pool draws launches, so length and importance trade off
unless the bar for launches rises. Its episode stays in `replay-3/` so CI judges it.
