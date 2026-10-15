# Judged replays (episode-eval run 38748997679, head 533d3dd)

Jev labels importance, claude-sonnet-5-5 scores quality; two runs each. "disagree" fails the row.

| Replay | Episode | Length | Topics | Importance (Jev) | Quality (Sonnet) |
|---|---|---|---|---|---|
| 0 (main) | daily | 4.8/5 PASS | 5/12 | 48% major, 2 changelog | 2.50 |
| 0 (main) | weekly | 9.4/15 | 9/13 | 56% major, 6 changelog, disagree | 2.50 |
| 1 coverage | daily | 4.8/5 PASS | 8/12 | 55% major, 3 changelog | 2.50, disagree |
| 1 coverage | weekly | 9.3/15 | 10/13 | 60% major, 5 changelog, disagree | 2.25, disagree |
| 2 airtime | daily | 5.1/5 PASS | 10/12 (best possible) | 71% major, 1 changelog | 2.75, disagree |
| 2 airtime | weekly | 9.3/15 | 10/13 (best possible) | 56% major, 5 changelog, disagree | 2.50 |
| 3 reverted | daily | 5.1/5 PASS | 10/12 | 71% major, 1 changelog | 3.00, disagree |
| 3 reverted | weekly | 14.4/15 PASS | 10/13 | 54% major, 10 changelog | 2.75 |

Readings:

- Iteration 2 lifts the daily from 48% to 71% major and 2 to 1 changelog: airtime moved from
  five Tech releases to one story per topic. Importance is still under 80%.
- The weekly's changelogs come from `developer_tool_launches` package releases (I1): with craft
  depth near 0 they still score 0.45 to 0.64 and clear the 0.4 bar. Fixing that is a scoring
  policy (what a release must be to air), not a selection bug; the judge's `launch_scale` is
  missing on most of these entries, so routing them through it would drop them by absent data.
- Quality is 2.25 to 3.00 everywhere, lowest on no repetition and worth listening. The replay
  reads the writer's stories as written, so selection cannot move it: it is the writer stage.
- The quality judge disagrees with itself on about half the episodes at the model's own effort,
  so the quality row can fail on noise alone.
