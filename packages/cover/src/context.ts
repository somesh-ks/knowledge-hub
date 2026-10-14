import { isoWeek, MONTH_NAMES, rangeLabel } from "./calendar.js";
import { layoutLockup, MARGIN_UNITS } from "./lockup.js";
import { getPalette, invertPalette } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import { dress, schemeFor } from "./season.js";
import { pad } from "./svg.js";
import type { CoverKind, CoverMeta, CoverSpec, Ctx, Rect, Variant } from "./types.js";

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
export const WEEKLY_INSET = 44;

/** `monthly` presses an on-demand briefing and an episode as the round plate on a matte. */
export function variantOf(kind: CoverKind, monthly = false): Variant {
  if (kind === "weekly") return "weekly";
  if (kind === "episode" || kind === "on-demand")
    return monthly ? "plate" : kind === "episode" ? "episode" : "regular";
  return "regular";
}

/** Builds the template context for a square canvas of `size`. */
export function buildContext(
  spec: CoverSpec,
  meta: CoverMeta,
  size: number,
  lockupMode: "standard" | "own",
  monthly = false,
): BuiltContext {
  const { year, month, day } = parseDate(meta.date);
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

  const uid = `c${hash32(`${spec.template}|${spec.palette}|${spec.seed}|${meta.date}|${meta.kind}|${size}|${monthly}`).toString(36)}`;
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
    ...(season?.matte
      ? { matte: season.matte, plate: { cx: size / 2, cy: size * 0.4, r: size * 0.275 } }
      : {}),
    uid,
    margin,
    quiet: variant === "plate" ? [] : quiet,
    area,
    lockup,
  };
  return { ctx };
}
