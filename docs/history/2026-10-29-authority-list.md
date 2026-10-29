# Authority list: Step 2 of the pipeline plan

2026-10-29. Official announcements describe no technique, so the depth score sinks them: anthropic-blog passed 0 of 15 judged items, deepmind-blog 1 of 17, openai-blog 9 of 85 (33 flagged as hype). The pipeline plan asked for hand-vetted authority per topic and Exa restricted to trusted domains (D234).

## What was built

- `config/authority.json`, shipped off, seeded with three lab domains. The lift reads an item at craft depth 0.25 and ignores the hype and sponsored flags, only for the categories the owner vetted the domain for. It scores about 0.52: over the bar, under real technique.
- The same list makes a vetted page pass the prefilter and gives each vetted category its own Exa query with `include_domains`.
- Off, the write stage logs what the list would add; `singularity authority replay <pools-dir>` scores unpacked pools both ways and flags a domain over 30%.
- A topic judged by fit may carry a `rubric`. None is seeded: it changes what airs.

## What could not be done

The plan asked for a replay of 14 days of pools. The run artifacts were empty (0 for the 05:37 run of 10-29), `state/judgments.json` has no source or URL, and the Neon `ingest_items` cover only free sources from 10-29. So the evidence is the shadow log of real runs. In the judgment cache, 49 items were judged frontier-model; 10 pass today and at most 47 would if all came from vetted domains.

## Open

Somesh signs off the list (Linear's blog is the one borderline cut), then `enabled` goes true.
