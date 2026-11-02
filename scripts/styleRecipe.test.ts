import { describe, expect, it } from "vitest";
import { gamutChroma } from "./colorRamp.js";
import {
  NEUTRAL_ROLES,
  type NeutralRecipe,
  neutralColors,
  neutralTone,
  targetChroma,
} from "./styleRecipe.js";

// Fitted by scripts/fitStyleRecipe.ts against the colours Expressive and Halloween wrote by hand;
// they move into tokens.json when a style is converted to a recipe (D319).
const FITTED: Record<string, NeutralRecipe> = {
  expressive: {
    depth: { light: 96, dark: 19 },
    paper: { hue: 292, tint: 0.07, lift: 0.06, sharp: 1 },
    ink: { hue: 292, tint: 0.07, lift: 0.06, sharp: 1 },
  },
  halloween: {
    depth: { light: 95.5, dark: 14 },
    paper: { hue: 82, tint: 0.04, lift: 0.04, sharp: 0.6 },
    ink: { hue: 302, tint: 0.04, lift: 0.04, sharp: 0.6 },
  },
};
const MODES = ["light", "dark"] as const;
// The reader's hue (D315) turns a style by any of these.
const TURNS = Array.from({ length: 72 }, (_, i) => i * 5);
const SURFACES = [
  "surface",
  "surface-sunken",
  "surface-container",
  "surface-raised",
  "surface-overlay",
];

describe.each(Object.keys(FITTED))("the neutral recipe of %s (D319)", (name) => {
  const recipe = FITTED[name] as NeutralRecipe;

  // Merged elevation steps pass the contrast sweep (text still reads) but flatten the page.
  it.each(MODES)("keeps the five surfaces at least 2 lightness points apart (%s)", (mode) => {
    const tones = SURFACES.map((role) => neutralTone(recipe, role, mode).l * 100).sort(
      (a, b) => a - b,
    );
    const gaps = tones.slice(1).map((tone, i) => tone - (tones[i] as number));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
  });

  // A grey ink or a grey page passes the contrast sweep and loses the style; the sRGB clip at a
  // turned hue is where chroma goes, since only the designed hue is gamut-capped. A dark ink at a
  // green hue cannot hold more than about 60% (the gamut), so the floor is half: it catches a tint
  // raised past what the gamut allows, which the hand-typed colours could not be checked for.
  it.each(MODES)("keeps half of each tinted role's chroma at every turned hue (%s)", (mode) => {
    const lost: string[] = [];
    for (const role of Object.keys(NEUTRAL_ROLES)) {
      const tone = neutralTone(recipe, role, mode);
      const wanted = targetChroma(recipe[NEUTRAL_ROLES[role]?.family[mode] ?? "paper"], tone.l);
      if (wanted < 0.02) continue;
      for (const turn of TURNS) {
        const kept = Math.min(1, (gamutChroma(tone.l, tone.h + turn) * 0.97) / wanted);
        if (kept < 0.5) lost.push(`${role} +${turn}: ${(kept * 100).toFixed(0)}%`);
      }
    }
    expect(lost).toEqual([]);
  });

  it("writes oklch literals a token can hold", () => {
    for (const roles of Object.values(neutralColors(recipe))) {
      for (const mode of MODES) expect(roles[mode]).toMatch(/^oklch\([\d.]+% [\d.]+ [\d.]+\)$/);
    }
  });
});
