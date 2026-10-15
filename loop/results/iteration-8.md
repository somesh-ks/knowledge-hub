# Iteration 8: endings, and length by measured airtime

Eval of iteration 7 (episode-eval run 38806559224):

| Episode | Length | Quality mean | no_repetition | Major share | Changelog |
|---|---|---|---|---|---|
| before-daily (main prompt) | 5.4 of 5 | 3.75 | 4 | 69% | 1 |
| after-daily (iteration 7) | 5.7 of 5, FAIL | 3.75 | 4 | 67% | 1 |
| before-weekly | 14.7 of 15 | 3.50 | 3 | 76% | 4 |
| after-weekly (iteration 7) | 15.5 of 15 | 3.50 | 3, then 4 | 84% | 2 |

The hedge closings were gone, and the judge heard a new formula in their place: 11 of 34 weekly
stories ended "so a team can...". Fixed: a story ends on its strongest fact, on what happens next
or on what it lets the reader do, mixed across a reply, never on that formula.

The daily ran 5.7 minutes because the writer tells a story longer than the 364-character average
that sizes the briefing. Fixed: validation airs survivors until their measured narration fills the
length (`length_chars`), cutting spares and over-long briefings alike, never ending short. A later
pass of the run still loses at most the length's count of stories.

Open: subject clusters (five token stories, three shadcn stories) and off-audience stories from the
owner's chosen topics, as in iteration 7.

## Result

Eval of iteration 8 (episode-eval run 38808546772, head 5d2c29f):

| Episode | Length | Quality mean | no_repetition | Major share | Changelog |
|---|---|---|---|---|---|
| before-daily (main prompt) | 5.6 of 5, FAIL | 3.50 | 3 | 84% | 0 |
| after-daily (iteration 8) | 5.2 of 5, PASS | 3.75 | 4 | 75% | 0 |
| before-weekly | 13.9 of 15 | 3.75 | 4 | 74% | 4 |
| after-weekly (iteration 8) | 14.1 of 15, PASS | 3.75 | 4 | 68% | 3 |

Both lengths pass, and the daily, which ran 5.7 minutes in iteration 7, now fits. The judge no
longer hears one closing formula; in the weekly, four stories still end on a caveat about their
own data. Quality stays below the rubric's 4 because of what airs, not how it is told: the
judge's top changes for both episodes are to cut off-audience stories (knit sensors, PC
shipments, a Riyadh strike, phone rollouts) and merge subject clusters (five token stories,
three shadcn stories, three "AI moves work to review" essays). Both need the owner's word: the
first is their chosen topics, the second a selection policy.
