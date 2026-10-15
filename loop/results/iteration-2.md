# Iteration 2: size a briefing by airtime, every section together (L1)

Change (not yet pushed, see iteration 1):

- `storiesForMinutes` (`packages/engine/src/run/scheduleSize.ts`): stories = minutes × 968 / 364.
  364 is spoken characters per story with its share of the frame, measured on October's seven
  briefings (60 stories, 21,850 characters), not on the replay. It replaces `capForLength`, which
  assumed 12 stories make 10 minutes (real: about 5).
- `selectItems` takes that number as `total`: Tech releases and the other own allowances now
  count inside the length instead of on top of it, the main sections leave one slot per own
  section, and each own section's best story comes first.

| Episode | Metric | Iteration 1 | Iteration 2 |
|---|---|---|---|
| replay-daily | length (script) | 4.8 of 5 min PASS | 5.1 of 5 min PASS |
| replay-daily | topics covered | 8 of 12 FAIL | 10 of 12 FAIL (the pool's best possible) |
| replay-daily | unselected airtime | 0% PASS | 0% PASS |
| replay-weekly | length (script) | 9.3 of 15 min FAIL | 9.3 of 15 min FAIL |
| replay-weekly | topics covered | 10 of 13 FAIL | 10 of 13 FAIL (best possible) |
| replay-weekly | unselected airtime | 0% PASS | 0% PASS |

Daily: 13 stories (was 12), consumer tech 5 → 1, frontier models and taste now in. Weekly
unchanged: its 18-story main cap binds before the length does (L2).

Tests: same 2 failures as iteration 1, nothing new. `capForLength` is now unused; its three tests
in `schedule-size.test.ts` pin dead code and go with the owner's word.
