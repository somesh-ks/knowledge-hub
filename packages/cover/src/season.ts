import { contrastRatio, hexToOklch, mixHex } from "./color.js";
import { getPalette } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import { TEMPLATES } from "./templates/index.js";
import type { Palette, TemplateId } from "./types.js";

/** Templates that draw outlined numerals or ring line art. A monthly cover uses solid flat fills only. */
const LINE_ART: readonly TemplateId[] = ["numeral", "orbit"];

/** The template a monthly cover draws: the picked one, or a flat one chosen by the seed. */
export function flatTemplate(template: TemplateId, seed: number): TemplateId {
  if (!LINE_ART.includes(template)) return template;
  const flat = TEMPLATES.filter((t) => !LINE_ART.includes(t));
  return flat[hash32(`flat:${seed}`) % flat.length] ?? template;
}

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

export function schemeFor(year: number, month: number): Scheme {
  const scheme = SCHEMES[(year * 12 + month - 1) % SCHEMES.length];
  if (!scheme) throw new Error("No cover schemes");
  return scheme;
}

/** Contrast floors: type on its ground, a figure on its ground. */
export const TYPE_CONTRAST = 4.5;
export const FORM_CONTRAST = 3;
/** A plate must read as a disc on its matte. */
const PLATE_CONTRAST = 1.6;
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

const isLight = (hex: string): boolean => hexToOklch(hex).l >= 0.7;

export interface Dress {
  /** Ground and figure the template draws with; on a plate, the disc and the art on it. */
  palette: Palette;
  /** The flat ground around a plate. Absent when the palette's own ground fills the cover. */
  matte?: string;
  /** Color of the date, month and wordmark. */
  type: string;
}

/** Every (ground, figure, type) the rules allow. With a plate: (matte, disc, art, type). */
function valid(colors: readonly string[], plate: boolean): string[][] {
  const out: string[][] = [];
  for (const ground of colors) {
    for (const type of colors) {
      if (contrastRatio(type, ground) < TYPE_CONTRAST) continue;
      for (const figure of colors) {
        if (!plate) {
          if (contrastRatio(figure, ground) >= FORM_CONTRAST && tintsOk(ground, figure))
            out.push([ground, figure, type]);
          continue;
        }
        // Plate: ground is the matte, figure the disc, then the art on the disc.
        if (contrastRatio(figure, ground) < PLATE_CONTRAST) continue;
        for (const art of colors) {
          if (contrastRatio(art, figure) >= FORM_CONTRAST && tintsOk(figure, art))
            out.push([ground, figure, art, type]);
        }
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

/** Throws when a scheme could leave a kind with no legal dress. Run by the contact sheet. */
export function assertSchemes(): void {
  for (const scheme of SCHEMES) {
    for (const plate of [false, true]) {
      if (valid(scheme.colors, plate).length === 0) {
        throw new Error(`Cover scheme "${scheme.id}" has no legal dress (plate ${plate})`);
      }
    }
  }
}

/**
 * The dress for one cover. `weekly` prefers a deep ground, as the matted weeklies do today; `plate`
 * is the on-demand layout. Seeded by the cover's own seed, so it is stable and varies by episode.
 */
export function dress(
  scheme: Scheme,
  spec: { palette: string; seed: number },
  kind: "daily" | "weekly" | "plate",
): Dress {
  const rng = mulberry32(hash32(`dress:${spec.seed}`));
  const plate = kind === "plate";
  let options = valid(scheme.colors, plate);
  if (kind === "weekly") {
    const deep = options.filter(
      ([g]) =>
        g !== undefined && contrastRatio(g, "#000000") > 2.2 && contrastRatio(g, "#000000") < 8,
    );
    if (deep.length > 0) options = deep;
  }
  if (kind !== "weekly") {
    // About a third of a month sits on a light ground, as production does.
    const light = options.filter(([g]) => g !== undefined && isLight(g));
    const dark = options.filter(([g]) => g !== undefined && !isLight(g));
    if (light.length > 0 && dark.length > 0) options = rng.chance(1 / 3) ? light : dark;
  }
  const pick = rng.pick(options);
  if (plate) {
    const [matte, disc, art, type] = pick as [string, string, string, string];
    return { palette: palette(spec.palette, disc, art, type), matte, type };
  }
  const [ground, figure, type] = pick as [string, string, string];
  return { palette: palette(spec.palette, ground, figure, type), type };
}
