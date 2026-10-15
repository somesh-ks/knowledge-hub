import { contrastRatio } from "./color.js";
import { getPalette } from "./palettes.js";
import { type PaperSeries, paper, SERIES_L } from "./series/paper.js";
import type { Palette } from "./types.js";

/**
 * Monthly colour schemes. A month draws every cover, of every kind, from one scheme: a small set of
 * colours taken from the existing palettes, kept inside one hue family or an analogous or
 * split-complementary set. Every cover of the month prints on that scheme's paper in its inks (see
 * series/paper.ts). The scheme follows the episode's own calendar month, so a past cover keeps its
 * colours.
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

export interface Dress {
  /** Ground and figure the template draws with; on an on-demand cover, the disc and the art on it. */
  palette: Palette;
  /** The flat ground of an on-demand cover. Absent when the palette's own ground fills the cover. */
  matte?: string;
  /** Color of the date, month and wordmark. */
  type: string;
}

/**
 * Throws when a scheme could leave a series with no paper: every month must find a pale colour, a
 * soft tint and a spot that holds on it, on every tint and in both themes. Run by the contact sheet.
 */
export function assertSchemes(): void {
  for (const scheme of SCHEMES) {
    for (const series of Object.keys(SERIES_L) as PaperSeries[]) {
      for (const mode of ["light", "dark"] as const) {
        const p = paper(scheme, mode, series);
        if (contrastRatio(p.K, p.P) < 4.5 || contrastRatio(p.D, p.P) < 3) {
          throw new Error(`Cover scheme "${scheme.id}" has no legible ${series} paper in ${mode}`);
        }
      }
    }
  }
}
