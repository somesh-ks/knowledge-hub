# Patch guide

How to turn a sentence into the smallest patch. The bounds are in `references/cli.md`; the shape of the file is `assets/patch.example.json`.

## Category phrasebook

The category names are the keys of `weights` in `config/preferences.json`.

| Category | Phrases that usually mean it |
| :--- | :--- |
| `design_engineering_craft` | craft, polish, details, design engineering, build notes |
| `hci_empirical_research` | papers, studies, usability research, HCI |
| `ui_component_primitives` | components, primitives, headless UI, Radix, shadcn |
| `ai_ux_interaction_patterns` | agent UX, AI interfaces, chat and copilot patterns |
| `css_canvas_motion_techniques` | CSS, canvas, shaders, WebGL, animation, springs, motion |
| `frontier_model_releases` | new models, model launches, benchmarks |
| `developer_tool_launches` | dev tools, CLIs, product launches |
| `taste_and_design_philosophy` | taste, essays, design philosophy |
| `venture_capital_and_gossip` | VC, funding, raises, gossip |
| `generic_ai_hype_listicles` | AI hype, listicles, "top 10" posts |

The last two never publish, whatever their weight; their weights only shade mixed items. For a hard exclusion use a disliked phrase. Plain "AI" fits several categories: ask which one, or use a keyword.

## Bound arithmetic

- A weight moves at most 0.05 per call; one call moves at most 0.15 in total, so three full-size moves.
- Moves apply in the order given; a move that no longer fits the total is cut to what is left or deferred.
- A weight at 1 cannot rise and at 0 cannot fall; the helper reports `headroom` or `skipped`.
- The CLI truncates to 0.01, so "slightly" (0.02) is the smallest useful ask.
- Clamping is not a refusal: apply what fits and say what was deferred. "Set it to 0" becomes -0.05 plus the offer to nudge again later.

## Worked examples

| Sentence | Patch |
| :--- | :--- |
| "more shaders, less VC funding" | `css_canvas_motion_techniques=+0.05`, `venture_capital_and_gossip=-0.05` |
| "much more design craft, ui primitives, motion and taste, and zero hype" | Helper caps and defers: the first three weights at +0.05, the rest deferred with a note |
| "follow Maggie Appleton" | `--add-author "Maggie Appleton"` |
| "no more Series A news" | `--add-disliked "series a"`, optionally `venture_capital_and_gossip=-0.05` |
| "less agentic UX" | `ai_ux_interaction_patterns=-0.05`, `--remove-keyword "agentic UX"` |
| "slightly more WebGPU" | `--add-keyword "webgpu"` and `css_canvas_motion_techniques=+0.02` |
| "more of rauno" when `rauno` is already an author | nothing left to change; say so |
