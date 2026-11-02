# Styles became recipes (D319)

Expressive typed 27 colours and Halloween 49 (plus shadows, which keep their literals like Default's). Each new style would have meant 30 to 50 more guesses that drift when the shared curve changes. D319 replaced the typing with `scripts/styleRecipe.ts`: one ladder of lightness for 15 neutral roles, plus per-style settings (page depth per mode, a paper and an ink family with hue, tint, lift and sharpness). Halloween's scene colours (bone, iron, stone, glow) use a second ladder on the same families. A style holds `$recipe` in `tokens/tokens.json`; `buildTokens.ts` expands it into overrides, so the hue turn (D315) and the state steps (D317) work unchanged.

What moved, and why:

- The ladder is the mean of what the two styles typed, so roles shifted by up to 0.04 in OKLab. The first pass left Expressive's light container too pale (0.055 typed, 0.038 generated), and Opus and Fable both saw it at turned hues, so `surface-container` carries a light-mode chroma boost of 1.4 (0.046 for Expressive, 0.041 for Halloween; the dark container needed none).
- Light muted text is 34 (Expressive's value, Halloween was 40): Expressive's violet container needs it for 4.5:1. Dark muted and subtle moved up two points for the overlay surface and the container.
- Halloween's light page depth is 96 (fit said 95.5): its orange accent on the container missed 4.5:1 by 0.05 at some hues.
- Accent outliers snapped to the ramp: Expressive's accent 44% is violet 700 (600 failed accent on accent-subtle at hues 220 to 295), accent-action 49% is violet 600. Halloween's dark accent containers are orange 900, 800, 700.
- `fitStyleRecipe.ts` is gone: it fitted a recipe to typed colours, and there are none left. The fitted numbers are the recipes in `tokens.json`.

Tests: `styleRecipe.test.ts` reads the recipes from `tokens.json` (surfaces stay 2 points apart, chroma at every turned hue, and no style types a colour). `documentUnder` in `buildTokens.test.ts` takes a style's values from the parsed overrides, so the 72-step contrast sweep judges the recipe's colours. Before this fix the sweep would have silently judged Default's neutrals for any recipe style.
