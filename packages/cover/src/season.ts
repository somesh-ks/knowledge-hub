import { contrastRatio, hexToOklch, mixHex } from "./color.js";
import { getPalette } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import type { Palette } from "./types.js";

/**
 * Monthly colour schemes. A month draws every cover, of every kind, from one scheme: a small set of
 * colours taken from the existing palettes, kept inside one hue family or an analogous or
 * split-complementary set. The seed picks which scheme colour takes the ground, the figure and the
 * type, and a draw that breaks a contrast rule is never chosen, so any cover a month makes looks
 * intended. The scheme follows the episode's own calendar month, so a past cover keeps its colours.
 */

type Role = "ground" | "accent" | "text";

export interface Scheme {
  id: string;
  /** Hue family, for the contact sheet. */
  note: string;
  colors: readonly string[];
}

const from = (...refs: readonly (readonly [string, Role])[]): string[] => [
  ...new Set(refs.map(([id, role]) => getPalette(id)[role])),
];

export const SCHEMES: readonly Scheme[] = [
  {
    id: "tide",
    note: "blue and aqua, analogous",
    colors: from(
      ["ultramarine", "ground"],
      ["cobalt-blush", "ground"],
      ["indigo-aqua", "ground"],
      ["petrol-bone", "ground"],
      ["glacier", "ground"],
      ["indigo-aqua", "accent"],
      ["ultramarine", "text"],
      ["glacier", "text"],
    ),
  },
  {
    id: "ember",
    note: "red, orange and amber, analogous",
    colors: from(
      ["oxblood", "ground"],
      ["fog-lingonberry", "accent"],
      ["graphite-signal", "accent"],
      ["kelp", "accent"],
      ["saffron-ink", "accent"],
      ["marigold-fog", "ground"],
      ["oxblood", "text"],
      ["fog-lingonberry", "ground"],
    ),
  },
  {
    id: "moss",
    note: "green to teal, analogous",
    colors: from(
      ["kelp", "ground"],
      ["lichen", "ground"],
      ["lichen", "accent"],
      ["petrol-bone", "ground"],
      ["petrol-bone", "accent"],
      ["kelp", "text"],
      ["lichen", "text"],
    ),
  },
  {
    id: "orchid",
    note: "violet and blush, orange accent",
    colors: from(
      ["plum-pearl", "accent"],
      ["graphite-signal", "ground"],
      ["indigo-aqua", "ground"],
      ["plum-pearl", "ground"],
      ["cobalt-blush", "accent"],
      ["graphite-signal", "accent"],
      ["graphite-signal", "text"],
      ["plum-pearl", "text"],
    ),
  },
];

/** The first month drawn with a monthly scheme. Earlier covers keep their original look. */
export const MONTHLY_FROM = "2026-10";

/** Whether a cover dated `date` (YYYY-MM-DD) is drawn in the monthly style. The one place that decides. */
export function isMonthly(date: string): boolean {
  return date.slice(0, 7) >= MONTHLY_FROM;
}

export function schemeFor(year: number, month: number): Scheme {
  const scheme = SCHEMES[(year * 12 + month - 1) % SCHEMES.length];
  if (!scheme) throw new Error("No cover schemes");
  return scheme;
}

/** Contrast floors: type on its ground, a figure on its ground. */
export const TYPE_CONTRAST = 4.5;
export const FORM_CONTRAST = 3;
/** The derived shade must stand apart from both ground and figure; the field only needs a trace of tint. */
const SHADE_CONTRAST = 1.6;
const FIELD_CONTRAST = 1.08;
const FIELD_MIX = 0.16;
const SHADE_MIX = 0.5;

const tintsOk = (ground: string, figure: string): boolean => {
  const shade = mixHex(ground, figure, SHADE_MIX);
  const field = mixHex(ground, figure, FIELD_MIX);
  return (
    contrastRatio(shade, ground) >= SHADE_CONTRAST &&
    contrastRatio(shade, figure) >= SHADE_CONTRAST &&
    contrastRatio(field, ground) >= FIELD_CONTRAST
  );
};

/**
 * The darkest series: a daily's ground stays at or under this OKLCH lightness, so even lifted for the
 * light theme it sits below the on-demand stock and the weekly paper.
 */
const DAILY_MAX_L = 0.55;

export interface Dress {
  /** Ground and figure the template draws with; on an on-demand cover, the disc and the art on it. */
  palette: Palette;
  /** The flat ground of an on-demand cover. Absent when the palette's own ground fills the cover. */
  matte?: string;
  /** Color of the date, month and wordmark. */
  type: string;
}

/** Every (ground, figure, type) the rules allow. */
function valid(colors: readonly string[]): string[][] {
  const out: string[][] = [];
  for (const ground of colors) {
    for (const type of colors) {
      if (contrastRatio(type, ground) < TYPE_CONTRAST) continue;
      for (const figure of colors) {
        if (contrastRatio(figure, ground) >= FORM_CONTRAST && tintsOk(ground, figure))
          out.push([ground, figure, type]);
      }
    }
  }
  return out;
}

function palette(id: string, ground: string, accent: string, text: string): Palette {
  const base = getPalette(id);
  return {
    ...base,
    ground,
    accent,
    text,
    field: mixHex(ground, accent, FIELD_MIX),
    shade: mixHex(ground, accent, SHADE_MIX),
  };
}

/** Throws when a scheme could leave a daily with no legal dress. Run by the contact sheet. */
export function assertSchemes(): void {
  for (const scheme of SCHEMES) {
    if (valid(scheme.colors).length === 0) {
      throw new Error(`Cover scheme "${scheme.id}" has no legal dress`);
    }
  }
}

/**
 * The dress for one daily (weeklies print on paper and on-demand covers on stock, see
 * series/weekly/kit.ts). Seeded by the cover's own seed, so it is stable and varies by episode.
 */
export function dress(scheme: Scheme, spec: { palette: string; seed: number }): Dress {
  const rng = mulberry32(hash32(`dress:${spec.seed}`));
  const all = valid(scheme.colors);
  const dark = all.filter(([g]) => g !== undefined && hexToOklch(g).l <= DAILY_MAX_L);
  const [ground, figure, type] = rng.pick(dark.length > 0 ? dark : all) as [string, string, string];
  return { palette: palette(spec.palette, ground, figure, type), type };
}
