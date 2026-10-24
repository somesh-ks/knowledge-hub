# The sound volume test and a V8 bug

2026-10-24. The owner asked why `recipes.test.ts` > "level control" > "scales the rendered peak with the master volume" sometimes failed in CI with a ratio of exactly 1, and to fix the cause, not the test.

## What the failures showed

- CI on 2026-10-22 (run 39825321446, #216) and 2026-10-24 (run 40092481568, #237) failed with the same digits: `full 0.03985982257798501 (7277 samples), half 0.03985982257798501`. The test's comment had two more on 2026-10-14.
- 0.03985982257798501 is the correct half-volume peak; the full-volume peak is 0.15943929031194004. So the full render's result read the half render's peak afterwards. Nothing computed it with the wrong gain.
- Vitest 5 runs each test file in a fresh process (`isolate: true`), so no other file could reach the renderer's state, and the renderer keeps none.

## The cause

A V8 bug in Node 24 (V8 13.6), [nodejs/node#66457](https://github.com/nodejs/node/issues/66457), fixed in V8 15.2 on Node's main; its cherry-pick (V8 7d5eb1df2a72) is not in the Node 24 changelog up to 24.22.1. When Maglev compiles a function's hot loop for on-stack replacement before the object literal after the loop has run, the objects that code returns can share one heap number per number field. The next call's stores then change the earlier result.

`renderRecipe` had that shape: the master gain loop, then `return { samples, sampleRate, peak, rms, audibleMs }`. `analyzeSpectrum` had it too.

## Evidence

- A plain script with the test file's call order and some allocation between calls, one fresh Node 24.22.1 process per run, 4 at a time: 4 of 400 and 5 of 400 runs changed an earlier result, one printing `ratio 1 full 0.03985982257798501 half 0.03985982257798501`, the CI line. Results kept from the test's collection phase changed too (`sheetOpen` returned peak 0.132 and later read 0.220), so the "rendered" tests could pass while checking another recipe's numbers.
- Controls: 0 of 800 with `--no-maglev-osr`, 0 of 800 on Node 22.
- `--trace-deopt` showed the issue's signature: eager deopts of `renderRecipe`'s OSR code at bytecode 328, the first store into the returned literal (321), and of `analyzeSpectrum`'s at 597 (literal at 577).
- Three full `npm test` runs on Node 24.22.1 passed before the fix, so it needs the timing of a busy runner (inferred).

## The fix

`render.ts` keeps each hot loop out of any function that returns an object literal. `applyMaster` and `measureSpectrum` hold the loops and return a `Float64Array`; `renderRecipe` and `analyzeSpectrum` build the objects and have no loop, so they never get OSR code. With the fix, the same script changed nothing in 1,600 runs (the old code: 4 in 1,600 that day), and traces show OSR and deopts only in the two helpers.

## Left open

Any function on Node 24 with a hot loop followed by a returned object literal with number fields can do this, the engine's included (it runs on Node 24 in Actions). A read-only sweep the same day found none with `renderRecipe`'s full shape and three possible ones, none reproduced: `generalCandidates` (`run/generalScope.ts`, a scored object pushed per story inside a loop of up to 600, then ranked), `selectItems` (`score/selectItems.ts`, `{ id, reason, score }` after a loop of about 100 to 700) and `prefilter` (`prefilter/prefilter.ts`, `{ item, score }` inside a loop over every fetched item, then sorted). The options are to keep such code in the same shape as `render.ts`, pass `--no-maglev-osr` to the Node processes (Node refuses it in `NODE_OPTIONS`, so it goes on each command line or in Vitest's `execArgv`), or move to a Node release that carries V8's fix once one exists.
