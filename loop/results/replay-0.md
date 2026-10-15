# Replay 0: selection as on main, on October's stories

`npx tsx loop/replay.ts loop/results/replay-0`, then `npx tsx loop/eval.ts` on each episode.
Judged rows come from the episode-eval workflow on the PR.

| Episode | Metric | Value | Verdict |
|---|---|---|---|
| replay-daily | length (script) | 4.8 of 5 min (776 words) | PASS |
| replay-daily | topics covered | 5 of 12; missing design_engineering_craft, ai_ux_interaction_patterns, css_canvas_motion_techniques, frontier_model_releases, developer_tool_launches, taste_and_design_philosophy, science | FAIL |
| replay-daily | unselected airtime | 0% | PASS |
| replay-weekly | length (script) | 9.4 of 15 min (1467 words) | FAIL |
| replay-weekly | topics covered | 9 of 13; missing ai_ux_interaction_patterns, taste_and_design_philosophy, science, culture | FAIL |
| replay-weekly | unselected airtime | 0% | PASS |

What the replay can and cannot say:

- The pool is every story published in October (60, 57 after dropping the 3 `trending` stories:
  the topic is off and the engine judges nothing for it). That is more varied than any one run's
  pool, so length here is indicative: the real 2026-10-13 daily aired 9 stories (3.6 min) from 26
  eligible because of drops after selection and its pool's mix.
- `ai_ux_interaction_patterns`, `science` and `culture` have no story in the pool, so no
  selection change can cover them here. The best possible topic rows are 10 of 12 (daily) and
  10 of 13 (weekly).
- The writer is not run: stories are read as they were written.
