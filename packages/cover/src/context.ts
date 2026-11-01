import { isoWeek, MONTH_NAMES, rangeLabel, yearLabel } from "./calendar.js";
import { layoutLockup, MARGIN_UNITS } from "./lockup.js";
import { tonePalette } from "./mode.js";
import { getPalette, invertPalette } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import { type Dress, isMonthly, schemeFor } from "./season.js";
import { paper, paperPalette, stock, stockPalette } from "./series/paper.js";
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

/** Weeklies before the monthly style sit in a matte: the art is inset from the edge, ringed by a hairline. */
export const WEEKLY_INSET = 56;

/** `monthly` prints an on-demand briefing and an episode on the month's stock ("plate"). */
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
  if (monthly) {
    // Monthly covers print on the month's paper in its inks, each series on its own close tint, and
    // carry their own tones for each theme, so they skip the generic toning.
    const mode = meta.mode ?? "light";
    const scheme = schemeFor(year, month);
    if (variant === "plate") {
      const matte = stock(scheme, mode);
      const { palette: pal, type } = stockPalette(base, paper(scheme, mode), matte);
      return { pal, variant, season: { palette: pal, type, matte } };
    }
    const p = paper(scheme, mode, variant === "weekly" ? "weekly" : "daily");
    const pal = paperPalette(base, p);
    return { pal, variant, season: { palette: pal, type: p.K } };
  }
  const pal = variant === "episode" ? invertPalette(base) : base;
  return { pal: meta.mode ? tonePalette(pal, meta.mode) : pal, variant, season: undefined };
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
  // A framed weekly's type sits on the plate, so its margin grows by the matte.
  const framed = variant === "weekly" && !monthly;
  const margin = (framed ? MARGIN_UNITS + WEEKLY_INSET : MARGIN_UNITS) * u;
  const monthName = MONTH_NAMES[month - 1] ?? "January";
  const caption = weekly ? rangeLabel(meta.date) : monthName;
  const lockup = layoutLockup(
    size,
    size,
    u,
    numeral,
    caption,
    margin,
    yearLabel(meta.date, weekly),
  );

  const inset = framed ? WEEKLY_INSET * u : 0;
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
    uid,
    margin,
    quiet,
    area,
    lockup,
  };
  return { ctx };
}
