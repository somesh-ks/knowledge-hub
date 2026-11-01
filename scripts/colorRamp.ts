/**
 * The one OKLCH curve every color ramp is drawn on.
 *
 * Why it exists: ramps used to be hand-picked (blue had 14 steps, grey 16, status colors 4), so a
 * new hue meant new guesses and no two ramps agreed on what "600" means. Now a ramp is a hue and a
 * peak chroma. Lightness comes from one shared curve and chroma from one shared bell over that
 * lightness, capped at the sRGB gamut, so step N of any ramp sits at the same lightness and the
 * same step number means the same contrast against white or ink in every hue.
 *
 * tokens/tokens.json holds the generated values (CSS and tests read the file, not this module);
 * `npx tsx scripts/colorRamp.ts` rewrites them and scripts/buildTokens.test.ts re-derives them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { oklchToRgb } from "./colorMath.js";

/** Ten steps per color. 50 is the lightest tint, 900 the darkest shade. */
export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type RampStep = (typeof RAMP_STEPS)[number];

/** Lightness of step 50 and step 900. Pages sit on the ends: 50 in light mode, 900 in dark. */
export const LIGHTNESS_FIRST = 0.98;
export const LIGHTNESS_LAST = 0.25;

/** How much of the S-curve (against a straight line) shapes the lightness steps. */
const EASE_SHARE = 0.35;

/** Where the chroma bell starts, how wide it spans, and how sharply it narrows (see `chromaShape`). */
const BELL_FLOOR = 0.15;
const BELL_SPAN = 0.9;
const BELL_SHARPNESS = 1.4;

export interface RampSpec {
  hue: number;
  /** Chroma at the bell's widest point, around lightness 0.6. Gamut caps it where it cannot fit. */
  peak: number;
}

/** The hue and peak chroma per color: the only thing a ramp is allowed to choose. */
export const RAMPS = {
  grey: { hue: 260, peak: 0.011 },
  blue: { hue: 260, peak: 0.195 },
  green: { hue: 155, peak: 0.15 },
  orange: { hue: 47, peak: 0.17 },
  red: { hue: 28, peak: 0.19 },
  violet: { hue: 292, peak: 0.24 },
} as const satisfies Record<string, RampSpec>;
export type RampName = keyof typeof RAMPS;

/**
 * Surfaces are not ramp steps. Ten steps sit about 8 lightness points apart, but elevation reads
 * at 2 to 3: the dark page, sunken fill, container and overlay are 25, 28, 30 and 33. So each
 * surface is the neutral ramp's page step moved by a small lightness offset, in points of
 * lightness. Light mode lowers the page (the tonal fills); dark mode lifts it (higher is nearer).
 */
export const SURFACE_OFFSETS = {
  light: { page: 0, sunken: -2, container: -3 },
  dark: { page: 0, sunken: 3, container: 5, overlay: 8 },
} as const;

/** Lightness at a step, easing the ends so the first and last steps cluster like real paper and ink. */
export function lightnessAt(step: RampStep): number {
  const t = RAMP_STEPS.indexOf(step) / (RAMP_STEPS.length - 1);
  const smooth = t * t * (3 - 2 * t);
  const eased = (1 - EASE_SHARE) * t + EASE_SHARE * smooth;
  return LIGHTNESS_FIRST - (LIGHTNESS_FIRST - LIGHTNESS_LAST) * eased;
}

/** Share of the peak chroma at a lightness: 0 at the ends, 1 near lightness 0.6. */
function chromaShape(lightness: number): number {
  const u = (lightness - BELL_FLOOR) / BELL_SPAN;
  return Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** BELL_SHARPNESS;
}

/** Highest chroma that still fits sRGB at this lightness and hue. */
export function gamutChroma(lightness: number, hue: number): number {
  let low = 0;
  let high = 0.4;
  for (let pass = 0; pass < 24; pass += 1) {
    const mid = (low + high) / 2;
    if (oklchToRgb({ l: lightness, c: mid, h: hue, alpha: 1 }).inGamut) low = mid;
    else high = mid;
  }
  return low;
}

export interface RampStepColor {
  l: number;
  c: number;
  h: number;
}

export function rampStep(name: RampName, step: RampStep): RampStepColor {
  const { hue, peak } = RAMPS[name];
  const l = lightnessAt(step);
  const c = Math.min(peak * chromaShape(l), gamutChroma(l, hue) * 0.97);
  return { l, c, h: hue };
}

/** A surface tone: the neutral ramp's page step with its lightness moved by `offset` points. */
export function surfaceTone(
  mode: "light" | "dark",
  level: keyof (typeof SURFACE_OFFSETS)["light"] | keyof (typeof SURFACE_OFFSETS)["dark"],
): RampStepColor {
  const base = rampStep("grey", mode === "light" ? 50 : 900);
  const offsets: Record<string, number> = SURFACE_OFFSETS[mode];
  const offset = offsets[level];
  if (offset === undefined) throw new Error(`No ${level} surface in ${mode} mode`);
  return { ...base, l: base.l + offset / 100 };
}

/** `oklch(56.62% 0.1893 260)`: percent lightness to two places, chroma to four, hue to one. */
export function formatOklch({ l, c, h }: RampStepColor): string {
  return `oklch(${(l * 100).toFixed(2)}% ${c.toFixed(4)} ${h})`;
}

const SURFACE_LEVELS = {
  light: ["sunken", "container"],
  dark: ["sunken", "container", "overlay"],
} as const;

const RAMP_DESCRIPTIONS: Record<RampName, string> = {
  grey: "Neutral. The blue hue at a whisper of chroma, so greys sit with the accent. 50 and 900 are the light and dark pages; surfaces between them are the elevation group.",
  blue: "The one accent. Low steps are tints, middle steps fills and accent text, high steps ink; which step a role takes is in the semantic tokens.",
  green: "Success.",
  orange: "Warning. Clear orange, not brown: hue 47 keeps step 500 at 4.5:1 as text.",
  red: "Danger.",
  violet:
    "The Expressive style's accent: an electric violet at the highest chroma the curve allows, so a selected state, a fill and a tint read as colour, not as grey with a hint.",
};

type JsonObject = Record<string, unknown>;

/** Every primitive color token this module owns, in file order. */
export function derivedColors(): JsonObject {
  const color: JsonObject = { $type: "color", white: { $value: "oklch(100% 0 0)" } };
  for (const name of Object.keys(RAMPS) as RampName[]) {
    const ramp: JsonObject = {};
    for (const step of RAMP_STEPS)
      ramp[String(step)] = { $value: formatOklch(rampStep(name, step)) };
    ramp.$description = RAMP_DESCRIPTIONS[name];
    ramp.$extensions = { singularity: { ramp: RAMPS[name] } };
    color[name] = ramp;
  }
  const elevation: JsonObject = {
    $description:
      "Surface tones between the neutral ramp's steps: the page step moved by a few points of lightness. Ten ramp steps are about 8 points apart; elevation reads at 2 to 5.",
    $extensions: { singularity: { surfaceOffsets: SURFACE_OFFSETS } },
  };
  for (const mode of ["light", "dark"] as const) {
    for (const level of SURFACE_LEVELS[mode]) {
      elevation[`${mode}-${level}`] = { $value: formatOklch(surfaceTone(mode, level)) };
    }
  }
  color.elevation = elevation;
  return color;
}

/** JSON the way Biome writes it: two-space indent, number arrays on one line. */
export function formatTokensJson(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return `[${value.join(", ")}]`;
  }
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${pad}  ${formatTokensJson(item, indent + 1)}`).join(",\n")}\n${pad}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${pad}  ${JSON.stringify(key)}: ${formatTokensJson(item, indent + 1)}`,
    );
    return `{\n${entries.join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** Rewrites primitive.color in tokens.json from the curve; every other token is left as it is. */
export function writeRamps(path: string): void {
  const document = JSON.parse(readFileSync(path, "utf8")) as { primitive: JsonObject };
  document.primitive.color = derivedColors();
  writeFileSync(path, `${formatTokensJson(document)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeRamps(resolve(dirname(fileURLToPath(import.meta.url)), "../tokens/tokens.json"));
}
