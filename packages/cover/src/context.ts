import { isoWeek, MONTH_NAMES, rangeLabel } from "./calendar.js";
import { layoutLockup, MARGIN_UNITS } from "./lockup.js";
import { type CoverMode, holdContrast, toneFor, tonePalette } from "./mode.js";
import { getPalette, invertPalette } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import {
  type Dress,
  dress,
  isMonthly,
  MATTE_CONTRAST,
  schemeFor,
  TYPE_CONTRAST,
} from "./season.js";
import { pad } from "./svg.js";
import type { CoverKind, CoverMeta, CoverSpec, Ctx, Palette, Rect, Variant } from "./types.js";

export { MONTH_NAMES };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseDate(date: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(date);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Cover date must be YYYY-MM-DD, got "${date}"`);
  }
  return { year, month, day };
}

export interface BuiltContext {
  ctx: Ctx;
}

/** Weekly records sit in a matte: the art is a plate inset from the edge, ringed by a hairline. */
export const WEEKLY_INSET = 56;

/** `monthly` presses an on-demand briefing and an episode as the round plate on a matte. */
export function variantOf(kind: CoverKind, monthly = false): Variant {
  if (kind === "weekly") return "weekly";
  if (kind === "episode" || kind === "on-demand")
    return monthly ? "plate" : kind === "episode" ? "episode" : "regular";
  return "regular";
}

/** The palette a cover is drawn in, and on a monthly cover its season's dress (type, matte). */
function coverDress(
  spec: CoverSpec,
  meta: CoverMeta,
  monthly: boolean,
): { pal: Palette; variant: Variant; season: Dress | undefined } {
  const { year, month } = parseDate(meta.date);
  const variant = variantOf(meta.kind, monthly);
  const base = getPalette(spec.palette);
  const season = monthly
    ? dress(
        schemeFor(year, month),
        spec,
        variant === "weekly" ? "weekly" : variant === "plate" ? "plate" : "daily",
      )
    : undefined;
  const pal = season ? season.palette : variant === "episode" ? invertPalette(base) : base;
  return meta.mode ? forMode({ pal, variant, season }, meta.mode) : { pal, variant, season };
}

/** A plate's disc must read against its matte. */
const PLATE_CONTRAST = 1.6;

/**
 * The cover as the app's theme draws it: every colour toned for the mode, then each contrast rule
 * held again, the figure on its ground, the matte off its plate and the type on what it sits on.
 */
function forMode(
  dressed: { pal: Palette; variant: Variant; season: Dress | undefined },
  mode: CoverMode,
): { pal: Palette; variant: Variant; season: Dress | undefined } {
  const { variant, season } = dressed;
  const pal = tonePalette(dressed.pal, mode);
  if (!season) return { pal, variant, season };
  const plate = variant === "plate";
  const matte =
    season.matte &&
    holdContrast(toneFor(season.matte, mode), pal.ground, plate ? PLATE_CONTRAST : MATTE_CONTRAST);
  const under = plate && matte ? matte : pal.ground;
  const type = holdContrast(toneFor(season.type, mode), under, TYPE_CONTRAST);
  return {
    pal,
    variant,
    season: { palette: pal, type, ...(matte ? { matte } : {}) },
  };
}

/**
 * The colours a cover is drawn in, largest area first, for light the page casts around it. A monthly
 * cover takes its season's dress and an older episode is inverted, so `spec.palette` alone is not
 * what the cover shows.
 */
export function coverColors(
  spec: CoverSpec,
  meta: CoverMeta,
): { ground: string; accent: string; shade: string } {
  const { pal, season } = coverDress(spec, meta, isMonthly(meta.date));
  return season?.matte
    ? { ground: season.matte, accent: pal.ground, shade: pal.accent }
    : { ground: pal.ground, accent: pal.accent, shade: pal.shade };
}

/** Builds the template context for a square canvas of `size`. */
export function buildContext(
  spec: CoverSpec,
  meta: CoverMeta,
  size: number,
  lockupMode: "standard" | "own",
  monthly = false,
): BuiltContext {
  const { month, day } = parseDate(meta.date);
  const { pal, variant, season } = coverDress(spec, meta, monthly);
  const weekly = variant === "weekly" && monthly;
  const numeral = weekly ? `W${isoWeek(meta.date)}` : String(day);
  const u = size / 1024;
  // The weekly's type sits on the plate, so its margin grows by the matte.
  const margin = (variant === "weekly" ? MARGIN_UNITS + WEEKLY_INSET : MARGIN_UNITS) * u;
  const monthName = MONTH_NAMES[month - 1] ?? "January";
  const caption = weekly ? rangeLabel(meta.date) : monthName;
  const lockup = layoutLockup(size, size, u, numeral, caption, margin);

  const inset = variant === "weekly" ? WEEKLY_INSET * u : 0;
  const area: Rect = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
  const quiet =
    lockupMode === "own"
      ? [pad(lockup.mark, 24 * u), pad(lockup.month, 24 * u)]
      : [pad(lockup.date, 30 * u), pad(lockup.mark, 24 * u)];

  const uid = `c${hash32(`${spec.template}|${spec.palette}|${spec.seed}|${meta.date}|${meta.kind}|${size}|${monthly}|${meta.mode ?? ""}`).toString(36)}`;
  const ctx: Ctx = {
    w: size,
    h: size,
    u,
    rng: mulberry32(spec.seed),
    seed: spec.seed,
    pal,
    variant,
    day,
    monthName,
    numeral,
    caption,
    ink: season?.type ?? pal.text,
    ...(season?.matte ? { matte: season.matte } : {}),
    ...(season?.matte && variant === "plate"
      ? { plate: { cx: size / 2, cy: size * 0.4, r: size * 0.275 } }
      : {}),
    uid,
    margin,
    quiet: variant === "plate" ? [] : quiet,
    area,
    lockup,
  };
  return { ctx };
}
