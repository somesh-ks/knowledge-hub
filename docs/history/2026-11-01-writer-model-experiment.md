# Writer model experiment (2026-11-01)

The owner asked for the lowest run cost he can get and for a test of Sonnet 5.5 and Haiku 5.5 at medium thinking against Gemini 3.8 Flash, rated by Jev, to learn which model suits which job. The ledger priced Sonnet at 3/15 per MTok; the real price is 2/10, and the writer's output is mostly thinking at the default `high` effort, so effort is the first lever.

`packages/engine/eval/writerModels.ts` writes the same stories with each arm (Sonnet high, medium, low, Haiku medium, Gemini Flash), runs the house linter, grounds summary and spoken text with Jev, asks Jev three Noul questions (clear, tight, worth airing), and prices tokens. It writes `results.md`, `results.json` and `blind.md` (each arm's telling under a shuffled letter) so the owner can read without knowing the model.

`run.yml` starts it after Validate when a dispatch sets `writer_experiment`, on the run's own `materials.json`. The repository is public (D298), so the stories, their source text and the owner's block prompts never leave the runner: no artifact, and only the score table goes to the step summary. The blind read stays on the runner until D300/D301 give a private place to put it.

The first pass only is compared; the voice rewrite loop is left out so the model alone is measured. Jev is one judge and favours its own habits, so a small gap needs the blind read. The router stays static: it takes the step's chain and falls back only on failure. A feedback-aware route (Regenerate and Catch up choosing a model) waits for these results.
