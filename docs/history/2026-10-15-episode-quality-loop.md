# Episode quality loop

2026-10-15. PRs #141, #144, #147, #148, #149, #150. Decision D119. Iteration records in `loop/results/`.

## The ask

Episodes ignored the length setting, release notes flooded them, chosen topics went missing, and the writing was flat. The owner asked for an eval loop of at most eight iterations under `loop/`, with the eval, rubric and fixtures frozen.

## What was wrong, and the fix

- Length: a story count capped at 12 or 18 decided the size, not the minutes asked for. Now the length alone sizes a briefing (#144, #147), and since #150 validation airs survivors by their measured narration, with 30% spares written so a grounding drop does not shorten it (D119). The 10-15 daily aired 4 stories because Sonnet 5.5 rejected `temperature` and spent its tokens thinking, so every run silently fell back to Nebius (#148), and grounding then dropped stories with nothing to replace them.
- Release notes: they cleared the importance bar like any story. Patch releases never air; other release notes take at most a tenth of the stories (#148).
- Topics: a topic's best story now airs before any topic's second (#144).
- Writing: the judge's reasons, not its scores, drove iterations 6 to 8 (`loop/inspect.ts`). Each fix exposed the next formula: hedge endings, then "so a team can" endings, now mixed. Stories open on the news, say at most two numbers and carry no version strings.

## What the loop taught

- The quality judge swings by 0.25 between runs on the same episode; read its reasons, never chase the number.
- What airs limits quality more than how it is told. The judge's top two changes for both final episodes were to cut off-audience stories and merge subject clusters, which need the owner's word (topics and a selection policy).
- A model that rejects a parameter fails silently into the fallback provider; check which model wrote a run.
