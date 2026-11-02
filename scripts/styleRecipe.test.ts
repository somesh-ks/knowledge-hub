import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gamutChroma } from "./colorRamp.js";
import {
  NEUTRAL_ROLES,
  type NeutralRecipe,
  neutralTone,
  recipeColors,
  targetChroma,
} from "./styleRecipe.js";

// The recipes a style carries in tokens.json (D319), read where the build reads them.
const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../tokens/tokens.json"), "utf8"));
const FITTED: Record<string, NeutralRecipe> = Object.fromEntries(
  Object.entries(raw.styles as Record<string, { $recipe?: NeutralRecipe }>)
    .filter(([, style]) => style.$recipe)
    .map(([name, style]) => [name, style.$recipe as NeutralRecipe]),
);
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
    for (const roles of Object.values(recipeColors(recipe))) {
      for (const mode of MODES) expect(roles[mode]).toMatch(/^oklch\([\d.]+% [\d.]+ [\d.]+\)$/);
    }
  });
});

// A colour typed into a style is a guess the contrast sweep can only judge after the fact, and it
// does not turn with the recipe. Styles hold recipes and ramp steps; shadows keep their literals.
describe("styles hold no typed colours (D319)", () => {
  it("writes every style colour as a recipe, a ramp step or an alias", () => {
    const typed: string[] = [];
    const walk = (node: unknown, path: string[]): void => {
      if (typeof node === "string") {
        if (/^oklch\(|^#|^rgb/.test(node) && !path.includes("shadow")) typed.push(path.join("."));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, child] of Object.entries(node)) {
        if (key !== "$recipe") walk(child, [...path, key]);
      }
    };
    walk(raw.styles, []);
    expect(typed).toEqual([]);
  });
});
