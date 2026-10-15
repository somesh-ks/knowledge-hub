# Iteration 4: the settings' length sizes both briefings (L2)

Owner, 2026-10-15: "the length should not be hard coded for daily/weekly, it should follow the
settings." Iteration 3 again, plus the validator: `validateStage` and `commitStage` (engine
selections) check the count against the digest's hard cap of 48, since selection already held the
pass to its length; agent-written selections keep the kind's cap.

| Episode | Metric | Iteration 2 | Iteration 4 |
|---|---|---|---|
| replay-daily | length (script) | 5.1 of 5 min PASS | 5.1 of 5 min PASS |
| replay-weekly | length (script) | 9.3 of 15 min FAIL | 14.4 of 15 min PASS |
| replay-weekly | topics covered | 10 of 13 | 10 of 13 (best possible) |

Trade-off: the 15-minute weekly draws 40 stories, 11 of them `developer_tool_launches`, so its
changelog count rises (judged in CI on `replay-4/`). On a Sunday the daily claims its stories
before the weekly, so a long daily leaves the weekly fewer; `general-pipeline.test.ts`'s Sunday
fixture now sets the production daily length (5 minutes) instead of the 10-minute default, which
with its small feed left the weekly nothing.
