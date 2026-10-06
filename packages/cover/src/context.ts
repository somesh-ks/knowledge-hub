import { type LockupLayout, layoutLockup, MARGIN_UNITS } from "./lockup.js";
import { getPalette } from "./palettes.js";
import { hash32, mulberry32 } from "./prng.js";
import { pad } from "./svg.js";
import type { Corner, CoverMeta, CoverSpec, Ctx, Rect } from "./types.js";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

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

/** Bottom-left leads, so the archive reads as one series, with enough variety to stay alive. */
const CORNER_WEIGHTS: ReadonlyArray<readonly [Corner, number]> = [
  ["bl", 44],
  ["tl", 22],
  ["br", 22],
  ["tr", 12],
];

function opposite(corner: Corner): { fx: number; fy: number } {
  return {
    fx: corner === "bl" || corner === "tl" ? 1 : 0,
    fy: corner === "bl" || corner === "br" ? 0 : 1,
  };
}

export interface BuiltContext {
  ctx: Ctx;
  lockup: LockupLayout;
}

/** Builds the template context for a canvas of w by h. */
export function buildContext(spec: CoverSpec, meta: CoverMeta, w: number, h: number): BuiltContext {
  const { month, day } = parseDate(meta.date);
  const pal = getPalette(spec.palette);
  const weekly = meta.kind === "weekly";
  const u = Math.min(w, h) / 1024;
  const layoutRng = mulberry32(hash32(`layout:${spec.seed}`));
  const corner = layoutRng.weighted(CORNER_WEIGHTS, (entry) => entry[1])[0];
  const margin = (weekly ? MARGIN_UNITS + 12 : MARGIN_UNITS) * u;
  const monthName = MONTH_NAMES[month - 1] ?? "January";
  const lockup = layoutLockup(w, h, u, corner, day, monthName, margin);

  const inset = weekly ? 52 * u : 0;
  const area: Rect = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 };
  const { fx, fy } = opposite(corner);
  const focus = {
    x: w * (fx ? layoutRng.range(0.58, 0.74) : layoutRng.range(0.26, 0.42)),
    y: h * (fy ? layoutRng.range(0.58, 0.74) : layoutRng.range(0.26, 0.42)),
  };

  const uid = `c${hash32(`${spec.template}|${spec.palette}|${spec.seed}|${meta.date}|${meta.kind}|${w}`).toString(36)}`;
  const ctx: Ctx = {
    w,
    h,
    u,
    rng: mulberry32(spec.seed),
    seed: spec.seed,
    pal,
    weekly,
    day,
    monthName,
    uid,
    margin,
    corner,
    quiet: [pad(lockup.box, 30 * u), pad(lockup.markBox, 26 * u)],
    area,
    focus,
  };
  return { ctx, lockup };
}
