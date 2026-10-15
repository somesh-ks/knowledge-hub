# Iteration 7: what the judges' reasons say, and spares for the length

Eval on PR #150 (episode-eval run 38804810921), writer rewriting each story from its page.
`loop/inspect.ts` printed each segment's Jev label and Sonnet's reasons (the eval is unchanged).

## Scores before this iteration

| Episode | Length | Quality mean | no_repetition | Changelog segments |
|---|---|---|---|---|
| before-daily (main prompt) | 5.3 of 5 | 3.75 | 4 | 1 |
| after-daily (iteration 6) | 5.4 of 5 | 3.75 | 4 | 0 |
| before-weekly | 14.4 of 15 | 3.50 | 3 | 5 |
| after-weekly | 14.6 of 15 | 3.50 | 3 | 2 |

Writing from the page, not the summary, brought the weekly from 13.2 to 14.6 minutes.

## Causes the judge names

1. Every story ends on a hedge ("still experimental", "a rerun would likely differ"). The prompt
   told the writer to end on the catch. Fixed: end on what the listener can do or decide; a catch
   that changes that comes before the ending.
2. Too many numbers, version strings and ids to follow by ear ("44,794 tokens", "Datasette
   1.0a41", "Qwen3.8-27B"). Fixed: at most two numbers, no version strings, ids or handles.
3. Setup openings ("Here's a playbook", "Most component libraries..."). Fixed: open on the news.
4. Subject clusters, not one story twice: five design-token stories, three shadcn stories and three
   "AI needs human checking" essays in one weekly. Not fixed: cutting them shortens a weekly that
   already airs every qualifying story; telling a cluster as one segment is a larger change.
5. Off-audience stories (knitted sensors, publisher traffic, EV chargers). They come from the
   owner's chosen topics (HCI research, World, consumer tech), so they stay.

## Production: the 2026-10-15 daily aired 4 stories for 5 minutes

The run (Actions 38716437515) selected 14, wrote 10 (Qwen; Sonnet was still failing) and
grounding dropped 6. Every story lost after selection came off the owner's length. Fixed: a
length-sized briefing selects and writes 30% spares, and validation airs the best survivors up to
the length, keeping each topic's best story (`run/scheduleSize.ts`). The run artifact now keeps
written.json and validate-report.json, so the next drop says why.
