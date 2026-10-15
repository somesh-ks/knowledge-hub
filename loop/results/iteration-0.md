# Iteration 0: baseline on unmodified code (main at 68aa9d1)

Run 2026-10-15 with `npx tsx loop/eval.ts`. The episodes are the ones production made from these inputs. No model key in this environment, so importance and quality are BLOCKED, and the variant settings have no episode (generating one needs the writer model).

| Episode | Metric | Value | Verdict |
|---|---|---|---|
| daily-2026-10-13 | length (script) | 3.6 of 5 min (600 words) | FAIL |
| daily-2026-10-13 | length (audio) | 3.8 of 5 min | FAIL |
| daily-2026-10-13 | topics covered | 4 of 12; missing design_engineering_craft, hci_empirical_research, ai_ux_interaction_patterns, css_canvas_motion_techniques, frontier_model_releases, developer_tool_launches, taste_and_design_philosophy, science | FAIL |
| daily-2026-10-13 | unselected airtime | 0% | PASS |
| daily-2026-10-13 | importance | no ANTHROPIC_API_KEY | BLOCKED |
| daily-2026-10-13 | quality | no ANTHROPIC_API_KEY | BLOCKED |
| daily-2026-10-13-variant | all | no episode for these settings | NOT GENERATED |
| weekly-2026-10-11 | length (script) | 3.7 of 15 min (585 words) | FAIL |
| weekly-2026-10-11 | length (audio) | 3.7 of 15 min | FAIL |
| weekly-2026-10-11 | topics covered | 5 of 13; missing design_engineering_craft, ai_ux_interaction_patterns, css_canvas_motion_techniques, frontier_model_releases, design, world, science, culture | FAIL |
| weekly-2026-10-11 | unselected airtime | 0% | PASS |
| weekly-2026-10-11 | importance | no ANTHROPIC_API_KEY | BLOCKED |
| weekly-2026-10-11 | quality | no ANTHROPIC_API_KEY | BLOCKED |
| weekly-2026-10-11-variant | all | no episode for these settings | NOT GENERATED |

2 of 14 pass.

## Every briefing this month (audio duration vs setting, outside the eval)

| Briefing | Setting | Audio | Items |
|---|---|---|---|
| 2026-10-06 | 5 min | 3.3 min | 10 |
| 2026-10-07 | 5 min | 3.4 min | 10 |
| 2026-10-09 | 5 min | 3.4 min | 9 |
| 2026-10-11-weekly | 15 min | 3.7 min | 10 |
| 2026-10-11 | 5 min | 2.9 min | 8 |
| 2026-10-13 | 5 min | 3.8 min | 9 |
| 2026-10-15 | 5 min | 1.6 min | 4 |

## Judged baseline (CI, run 38744864598, 2026-10-15 13:42 UTC)

Importance by Jev (`jev-latest`), quality by `claude-sonnet-5-5` (newest Sonnet on the model list), two runs each.

| Episode | Importance (Jev) | Quality (Sonnet) |
|---|---|---|
| daily-2026-10-13 | 47% major, 3 changelog: FAIL | mean 3.00, min 2; second run differs (3/3/2/2): FAIL |
| weekly-2026-10-11 | 70% major, 2 changelog: FAIL | mean 3.50, min 3 (4/3/4/3): FAIL |

Jev's two runs agreed on every segment. Sonnet's two runs disagreed on the daily, which the rubric counts as a fail.
Total with judges: 2 of 14 pass.
