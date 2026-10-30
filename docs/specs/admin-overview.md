# Admin overview

The command center's front page: how the app stands and what it costs, at a glance. Health first, then Spend. Both read live from the reader's `/api/health` and `/api/costs`; detail lives on `/admin/health` ([health](health.md)) and `/admin/costs` ([costs](costs.md)).

## Requirements

- Health is one ring with an arc for each of four pillars, in the order Content, Pipeline, Site, Server. There is no verdict title: the ring's middle names the open pillar and the arcs say how it all stands.
  - Content: whether briefings published (Daily, Weekly, Catch up, Narration).
  - Pipeline: what makes them (the workflow jobs, run times, model fallbacks, sources).
  - Site: what a browser sees (LCP, INP and CLS on phones and desktops, page errors, blocked scripts).
  - Server: what answers it (server errors, timeouts, database, content store).
  - An error check sits with what it breaks, never in a pillar of its own.
- An arc takes the tone of its worst check: fine, to check or failing. A flagged pillar's label carries a glyph in the tone beside its state text, which stays in ink, so tone never rests on colour alone and the words never rest on orange. The label text is "N failing", "N to check", "N flagged" or "Fine".
- A press on an arc or its label (a radio in a radiogroup, so the arrow keys walk them) opens that pillar's report below: flagged rows first, the fine ones collapsed under "N fine". The worst pillar is open on arrival.
- A check with no judgement (too few visits, or its part did not answer) is left out of the arcs; the note names a part that did not answer. A pillar with no judged check draws no arc.
- Spend is the 30-day total, a week strip of one ring a day (filled by that day's cost; a press shows what ran), and a split bar with its legend.
- All spacing, radius and type come from the design tokens. The warning orange is admin-local (`--ov-warning`) until the palette has a warning step.

## Scenarios

- WHEN a pillar has a warning check and a failing check THEN the arc is the failing tone and the label reads "2 flagged" (a count of both), not "1 failing".
- WHEN `/api/health` does not answer THEN the ring's middle reads "No answer", a note says the checks did not answer, and no arc is drawn.
- WHEN a pillar's label would reach the ring's edge THEN it stays inside the card (the vertical offset is clamped).

## Code

`apps/admin/src/pages/index.astro` (pillar rows), `apps/admin/src/scripts/overview.ts`, `apps/admin/src/styles/admin.css` (`ov-*`).
