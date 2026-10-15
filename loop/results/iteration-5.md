# Iteration 5: release notes and the writer (I1, quality)

Owner, 2026-10-15: "release notes should not take up too much of the podcast, increase the writing
quality for sure."

Release notes (selection, `score/releaseNotes.ts`): a story is a release note when it comes from a
GitHub release feed or its headline names a version number as its own word. A patch release
(x.y.z, z not 0) never airs; the rest take at most a tenth of the main stories, at least one.
Scoring is unchanged: `launch_scale` is missing on most October judgments, so routing release notes
through it would drop them by absent data, not by policy.

| Episode | Metric | Iteration 4 | Iteration 5 |
|---|---|---|---|
| replay-daily | length (script) | 5.1 of 5 min PASS | 5.1 of 5 min PASS |
| replay-daily | release notes | 1 | 1 (ttok 1.0) |
| replay-weekly | length (script) | 14.4 of 15 min PASS | 14.0 of 15 min PASS |
| replay-weekly | release notes | 11 developer_tool_launches, 4 package releases in ui_component_primitives | 2 by version (ttok 1.0, ttok 0.4) and 1 without one (a Datasette plugin) |

Writer (`write/prompt.ts`, `config/voice.md`): lead with the fact a listener did not know and say
what an unfamiliar name is; every sentence adds a fact; the catch in words that fit the story, "The
catch:" once per batch at most, and no generic risk when the source gives none; no two stories open
or close alike. Not done: the writer writes four stories a request, so two stories on one subject
in different requests can still repeat each other; passing the other headlines in would change an
existing writer test (`write-writer.test.ts`, four items a request). Every
October story ended on "The catch:", which the judge scored lowest on repetition.

The replay reads stories as written, so `loop/rewrite.ts` rewrites the latest replay with main's
prompt and with this branch's, from each story's summary (the pool keeps no source text), and the
eval judges both in CI (`rewrites/before-*`, `rewrites/after-*`).

Found while building the rewrite: every writer request to Claude Sonnet 5.5 failed with 400
("`temperature` is deprecated for this model"), and the writer chain fell back to Nebius without a
word. Since the owner picked Sonnet on 2026-10-14, the briefings have been written by the Nebius
model (the 2026-10-15 run: 8 Anthropic requests, 17 Nebius). The Anthropic client no longer sends a
temperature. This is likely a larger quality change than the prompt.
