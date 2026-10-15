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
