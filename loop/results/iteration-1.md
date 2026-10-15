# Iteration 1: every topic gets its best story first (T1)

Change: `selectItems` takes the best eligible story of each category before the per-section walk
(`packages/engine/src/score/selectItems.ts`). Not yet pushed: two existing tests pin the old
behaviour and need the owner's word to change.

Replay (`loop/replay.ts`, October's stories):

| Episode | Metric | Replay 0 | Iteration 1 |
|---|---|---|---|
| replay-daily | length (script) | 4.8 of 5 min PASS | 4.8 of 5 min PASS |
| replay-daily | topics covered | 5 of 12 FAIL | 8 of 12 FAIL |
| replay-daily | unselected airtime | 0% PASS | 0% PASS |
| replay-weekly | length (script) | 9.4 of 15 min FAIL | 9.3 of 15 min FAIL |
| replay-weekly | topics covered | 9 of 13 FAIL | 10 of 13 FAIL |
| replay-weekly | unselected airtime | 0% PASS | 0% PASS |

Daily still misses `frontier_model_releases` and `taste_and_design_philosophy`: the daily's main
cap is 6 slots for 8 main categories with stories (L1). `ai_ux_interaction_patterns`, `science` and
`culture` have no story in the pool. Weekly now covers every category the pool has.

Tests: 2423 of 2425 pass. The two failures are in `score-selectItems.test.ts` ("weekly reserved
slot"): they assert that a regular briefing leaves out a lone `developer_tool_launches` story and
that a weekly leaves out a median-weight `taste_and_design_philosophy` story, which is the
behaviour this iteration changes. Kept, not reverted: no metric regressed.
