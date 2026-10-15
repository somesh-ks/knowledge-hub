# Iteration 6: the same story twice, and the headline read twice

Owner, 2026-10-15: "go crazy! I'd like to get high quality output", "fix any bugs you find along the
way and iterate until finished".

Iteration 5's judge still gave the weekly 2 of 5 on repetition, with main's writer prompt and this
branch's alike. Reading the replayed weekly segment by segment showed where the repetition comes
from, and little of it is the writer's wording:

| What the listener heard | Cause | Fix |
|---|---|---|
| Mistral Large 4 twice (specs, then benchmarks), ColorOS 17 twice (beta, then rollout date), ttok twice (1.0, then 0.4), a plugin release about Mistral Large 4 | Fetch-time clustering joins one article syndicated twice or one launch covered the same week; it does not see one subject told from two angles on two days, and the one-release-per-repository rule covers GitHub feeds only | `score/sameStory.ts`: two headlines that share two words few headlines use, or two release notes of the same product, are one story; the best telling airs (`same_story` drop) and a release note never stands in for the news |
| "ttok 1.0 defaults to GPT-5 tokenizer. ttok 1.0 defaults to the GPT-5 tokenizer family..." (16 of 38 weekly stories had no spoken telling; 10 of those read a headline the summary then restates) | The voice check deletes a spoken telling that states a number the summary does not, with no second chance, and narration falls back to headline then summary | `write/enforceVoice.ts`: such a telling gets the same one rewrite a lint failure gets, told which number to fix. `audio/spokenText.ts`: the fallback leaves out a headline the summary opens by restating |
| "The catch: the piece doesn't include new evidence"; "The catch: the Houthis have warned more attacks are coming" after a death | Writer brief | `write/prompt.ts`: tell the news, never review the article; hard news ends on the latest fact, no catch |

Replay (selection only, stories as written):

| Episode | Metric | Iteration 5 | Iteration 6 |
|---|---|---|---|
| replay-daily | length (script) | 5.1 of 5 min PASS | 5.0 of 5 min PASS |
| replay-weekly | length (script) | 14.0 of 15 min PASS | 12.8 of 15 min FAIL |
| replay-weekly | stories | 38 | 36 |

The weekly runs short because every story that clears the bar already airs (51 qualify, 36 remain
once repeats go), and the restated headlines no longer pad it. Padding was airtime spent on
repetition; the fix for a thin week is depth, not more or weaker stories (next iteration).
