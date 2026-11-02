/**
 * A style's neutral colours as a recipe, not as typed values (D319).
 *
 * Why it exists: Expressive and Halloween each wrote about 30 neutral colours by hand (surfaces, text,
 * borders, tracks), so every new style meant another 30 guesses. Here those roles sit on one shared
 * ladder of lightness, and a style is only its settings: the page depth per mode, one hue per family
 * (paper and ink), and one chroma curve (tint, lift, sharpness). The same curve family draws the ramps
 * in colorRamp.ts; the lift keeps a dark page coloured where the ramp's bell would fade to grey.
 *
 * This module only derives values. The contrast sweep in buildTokens.test.ts judges whatever a style
 * emits, and styleRecipe.test.ts holds the generator's own invariants (surfaces stay apart and
 * coloured at every hue the reader's slider reaches).
 */
import { gamutChroma } from "./colorRamp.js";

export type Mode = "light" | "dark";

/** One hue and one chroma curve: chroma(L) = tint * bell(L)^sharp + lift * (1 - L), capped by the gamut. */
export interface Family {
  hue: number;
  tint: number;
  lift: number;
  sharp: number;
}

export interface NeutralRecipe {
  /** The tone of the page in light and dark, in points of lightness (0 to 100). */
  depth: Record<Mode, number>;
  /** Surfaces and borders are `paper` in light and `ink` in dark; type is the other way round. */
  paper: Family;
  ink: Family;
  /** The style draws its empty-state scenes (SCENE_ROLES) from the same two families. */
  scene?: boolean;
}

const BELL_FLOOR = 0.15;
const BELL_SPAN = 0.9;

function bell(lightness: number): number {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, (lightness - BELL_FLOOR) / BELL_SPAN)));
}

/** Chroma a family draws at a lightness, before the gamut cap. */
export function targetChroma(family: Family, lightness: number): number {
  return family.tint * bell(lightness) ** family.sharp + family.lift * (1 - lightness);
}

type FamilyName = "paper" | "ink";
type Offset = { from: "page"; points: number } | { from: "zero"; points: number };

interface RoleSpec {
  /** Which family colours the role in light and in dark. */
  family: Record<Mode, FamilyName>;
  /** A role may carry more chroma than the curve gives (a glow, a colour block); the gamut still caps it. */
  boost?: number | Partial<Record<Mode, number>>;
  /** Where its lightness sits: points from the page, or an absolute lightness. */
  light: Offset;
  dark: Offset;
}

const page = (points: number): Offset => ({ from: "page", points });
const at = (points: number): Offset => ({ from: "zero", points });
const GROUND: Record<Mode, FamilyName> = { light: "paper", dark: "ink" };
const TYPE: Record<Mode, FamilyName> = { light: "ink", dark: "paper" };
const MID: Record<Mode, FamilyName> = { light: "ink", dark: "ink" };
const PAPER: Record<Mode, FamilyName> = { light: "paper", dark: "paper" };

/**
 * The shared ladder. Numbers are the mean of what Expressive and Halloween wrote by hand: they sat
 * within a point or two of each other on every role but the dark page, which is why depth is a setting.
 */
export const NEUTRAL_ROLES: Record<string, RoleSpec> = {
  surface: { family: GROUND, light: page(0), dark: page(0) },
  "surface-sunken": { family: GROUND, light: page(-3), dark: page(-4) },
  "surface-container": { family: GROUND, boost: { light: 1.4 }, light: page(-5), dark: page(8) },
  "surface-raised": { family: GROUND, light: page(2), dark: page(13) },
  "surface-overlay": { family: GROUND, light: page(4), dark: page(16) },
  "surface-inverse": { family: TYPE, light: at(24), dark: at(93) },
  "on-surface": { family: TYPE, light: at(20), dark: at(95) },
  "on-surface-reading": { family: TYPE, light: at(22), dark: at(92.5) },
  "on-surface-muted": { family: MID, light: at(34), dark: at(81.5) },
  "on-surface-subtle": { family: MID, light: at(47), dark: at(73.5) },
  "on-surface-inverse": { family: GROUND, light: at(94), dark: at(20) },
  "border-hairline": { family: GROUND, light: page(-10.5), dark: page(13.5) },
  "border-control": { family: MID, light: at(53.5), dark: at(64) },
  track: { family: GROUND, light: page(-11), dark: page(16) },
  "track-strong": { family: GROUND, light: page(-27), dark: page(30) },
};

/**
 * The places in a style's empty-state scenes that are not an accent colour (a bone, an iron gate, a
 * stone, a glow). They sit on absolute lightness steps and borrow the style's two families, so a scene
 * follows the page's hue and the reader's hue turn. Keys are token paths under `component.scene`.
 */
export const SCENE_ROLES: Record<string, RoleSpec> = {
  glow: { family: PAPER, boost: 2.2, light: at(96), dark: at(95) },
  bone: { family: PAPER, light: at(99), dark: at(93) },
  "bone-shade": { family: GROUND, light: at(90), dark: at(78) },
  iron: { family: MID, light: at(30), dark: at(36) },
  "iron-shade": { family: MID, light: at(24), dark: at(28) },
  "iron-lit": { family: MID, light: at(40), dark: at(46) },
  stone: { family: MID, light: at(80), dark: at(46) },
  "stone-shade": { family: MID, light: at(70), dark: at(36) },
  "stone-lit": { family: MID, light: at(86), dark: at(54) },
};

export interface Tone {
  l: number;
  c: number;
  h: number;
}

function boostFor(spec: RoleSpec, mode: Mode): number {
  const { boost } = spec;
  return typeof boost === "number" ? boost : (boost?.[mode] ?? 1);
}

/** One role's colour in one mode: the ladder's lightness, the family's hue, the curve's chroma. */
export function neutralTone(recipe: NeutralRecipe, role: string, mode: Mode): Tone {
  const spec = NEUTRAL_ROLES[role] ?? SCENE_ROLES[role];
  if (!spec) throw new Error(`No neutral role ${role}`);
  const where = spec[mode];
  const l = (where.from === "page" ? recipe.depth[mode] + where.points : where.points) / 100;
  const family = recipe[spec.family[mode]];
  const c = Math.min(
    targetChroma(family, l) * boostFor(spec, mode),
    gamutChroma(l, family.hue) * 0.97,
  );
  return { l, c, h: family.hue };
}

export function formatTone({ l, c, h }: Tone): string {
  return `oklch(${trim(l * 100)}% ${trim(c)} ${trim(h)})`;
}

function trim(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Every colour a recipe writes, light and dark, as the CSS colour a token holds. Keys are token paths:
 * `semantic.color.<role>` for the neutral ladder, `component.scene.<role>` for the scene roles.
 */
export function recipeColors(recipe: NeutralRecipe): Record<string, Record<Mode, string>> {
  const out: Record<string, Record<Mode, string>> = {};
  const add = (prefix: string, roles: Record<string, RoleSpec>): void => {
    for (const role of Object.keys(roles)) {
      out[`${prefix}.${role}`] = {
        light: formatTone(neutralTone(recipe, role, "light")),
        dark: formatTone(neutralTone(recipe, role, "dark")),
      };
    }
  };
  add("semantic.color", NEUTRAL_ROLES);
  if (recipe.scene) add("component.scene", SCENE_ROLES);
  return out;
}

/**
 * True when `value` is a recipe a style can carry: two families with numbers in a sane range, two
 * depths whose every role stays between 0 and 100 lightness (checked on the ladder itself, so a new
 * role cannot slip past), and `scene` a boolean when present.
 */
export function isRecipe(value: unknown): value is NeutralRecipe {
  const within = (v: unknown, min: number, max: number): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const family = (v: unknown): boolean => {
    const f = v as Record<string, unknown> | null;
    return (
      typeof f === "object" &&
      f !== null &&
      within(f.hue, 0, 360) &&
      within(f.tint, 0, 0.3) &&
      within(f.lift, 0, 0.3) &&
      within(f.sharp, 0.1, 4)
    );
  };
  const holds = (mode: Mode, depth: number): boolean =>
    Object.values(NEUTRAL_ROLES).every((spec) => {
      const where = spec[mode];
      const l = where.from === "page" ? depth + where.points : where.points;
      return l >= 0 && l <= 100;
    });
  const r = value as Record<string, unknown> | null;
  const depth = r?.depth as Record<string, unknown> | undefined;
  return (
    !!r &&
    !!depth &&
    within(depth.light, 0, 100) &&
    within(depth.dark, 0, 100) &&
    holds("light", depth.light) &&
    holds("dark", depth.dark) &&
    family(r.paper) &&
    family(r.ink) &&
    (r.scene === undefined || typeof r.scene === "boolean")
  );
}
