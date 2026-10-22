# Sources and weights

2026-10-19 to 2026-10-20. Decision: D124. PRs #169 (design), #170 (source library), #171 (weight stops), #172 (mix and lean).

## Ask

The owner wanted a search bar with type filters on the sources, the topic weights turned into source-type weights plus a left versus right setting, meaningful weight names, fixed-value sliders, Jev guessing a new source's type, and every existing source classified. Then: run autonomously through review, commit, push and merge.

## What was decided in the brainstorm

- Source type joins the weights instead of replacing them: the weights say what a story is about, the format where it came from.
- Weight names became story kinds ("Build breakdowns", not "Design engineering craft"); ids stayed, because the judge, old digests and votes point at them.
- Seven formats; Newsletters and Official were folded into News and Blog.
- Lean from Jev with review, not AllSides or MBFC (licence, US-only coverage). The owner chose a Left to Right slider over a Balance toggle; it moves scores by up to 15% and removes nothing.

## How it was built

Two `dispatch-worker` agents built the weights and the source library in parallel worktrees; the mix and lean worker started on the weights branch before it merged. Each worker hit its 90-turn cap and was resumed; one had committed nothing, so its work was saved as a WIP commit first. A `reviewer` read each branch before its PR.

## What review and screenshots caught

- The Off categories could still render through `render.ts`; validate, curate and render read raw topic weights that `dispatch learn` does not update.
- The format mix first skipped the eleven built-in categories, so Design's sliders did nothing; then the page saved the mix on a fallback home topic the engine never read (`groupHomeId` now serves both).
- The outlet cap counted feeds, so BBC's five feeds were five outlets; it now counts the story's host and leaves sections of their own alone.
- On a phone the status chips wrapped mid-row; a format slider alone on a page (World) had nothing to weigh against and is hidden.

## Left

`npm run secrets:push` so Vercel can reach Jev; the general feeds lean centre-left (no Right outlets); `curate` ignores the mix.
