/**
 * Contact sheets for the monthly cover scheme, one PNG per month, written to cover-preview/ at the
 * repository root (not committed).
 *
 *   npx tsx packages/cover/scripts/preview.ts
 *
 * Each sheet: the month's scheme swatches with OKLCH values; 8 dailies, 3 weeklies and 4 on-demand
 * covers at 512px, today's output above the monthly output, on a ground split light and dark; then
 * the same covers at 48px, current above monthly, on each ground.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { hexToOklch } from "../src/color.js";
import { FONT_STACK, RESVG_FONT_OPTIONS } from "../src/fonts.js";
import { pickCover } from "../src/pick.js";
import { renderCoverSvg } from "../src/render.js";
import { assertSchemes, schemeFor } from "../src/season.js";
import type { CoverKind, CoverMeta } from "../src/types.js";

assertSchemes();

const OUT = fileURLToPath(new URL("../../../cover-preview/", import.meta.url));
const BIG = 512;
const SMALL = 48;
const GAP = 24;
const MARGIN = 40;
const LIGHT = "#f4f5f7";
const DARK = "#121316";
const MONTHS: readonly [number, number][] = [
  [2026, 10],
  [2026, 11],
  [2026, 12],
];
const DAILY_DAYS = [2, 5, 9, 12, 17, 21, 26, 30];
const WEEKLY_DAYS = [4, 14, 25];
const ON_DEMAND_DAYS = [6, 13, 20, 27];

const two = (v: number): string => String(v).padStart(2, "0");

function episodes(year: number, month: number): CoverMeta[] {
  const ym = `${year}-${two(month)}`;
  const make =
    (kind: CoverKind, prefix: string) =>
    (d: number, i: number): CoverMeta => ({
      kind,
      id: `${prefix}-${ym}-${two(d)}-${i}`,
      date: `${ym}-${two(d)}`,
    });
  return [
    ...DAILY_DAYS.map(make("regular", "d")),
    ...WEEKLY_DAYS.map(make("weekly", "w")),
    ...ON_DEMAND_DAYS.map(make("on-demand", "o")),
  ];
}

function nested(svg: string, x: number, y: number, size: number): string {
  return svg.replace(
    /width="1024" height="1024"/,
    `x="${x}" y="${y}" width="${size}" height="${size}"`,
  );
}

const label = (x: number, y: number, size: number, fill: string, value: string): string =>
  `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="${size}" font-weight="500" fill="${fill}">${value}</text>`;

for (const [year, month] of MONTHS) {
  const scheme = schemeFor(year, month);
  const list = episodes(year, month);
  const render = (monthly: boolean) =>
    list.map((meta) => renderCoverSvg(pickCover(meta), meta, { wordmark: false, monthly }));
  const current = render(false);
  const monthly = render(true);

  const width = MARGIN * 2 + 8 * BIG + 7 * GAP;
  const half = width / 2;
  const swatchTop = MARGIN + 36;
  const bigTop = swatchTop + 200;
  const row = (i: number) => bigTop + i * (BIG + GAP);
  const smallTop = row(4) + 60;
  const step = SMALL + 14;
  const height = smallTop + (SMALL + 14) * 2 + MARGIN;

  let body = `<rect width="${half}" height="${height}" fill="${LIGHT}"/><rect x="${half}" width="${half}" height="${height}" fill="${DARK}"/>`;
  body += label(
    MARGIN,
    MARGIN + 16,
    30,
    "#555",
    `${year}-${two(month)}  ${scheme.id}: ${scheme.note}`,
  );
  scheme.colors.forEach((hex, i) => {
    const o = hexToOklch(hex);
    const x = MARGIN + i * 200;
    body += `<rect x="${x}" y="${swatchTop}" width="180" height="110" fill="${hex}" stroke="#8884" stroke-width="2"/>`;
    body += label(
      x,
      swatchTop + 140,
      18,
      "#444",
      `L ${o.l.toFixed(2)}  C ${o.c.toFixed(2)}  H ${Math.round(o.h)}`,
    );
    body += label(x, swatchTop + 168, 18, "#444", hex);
  });

  const place = (svgs: readonly string[], rows: readonly [number, number][]) => {
    for (const [r, startIndex] of rows) {
      const count = r % 2 === 0 || startIndex === 0 ? 8 : 7;
      for (let c = 0; c < count; c += 1) {
        const svg = svgs[startIndex + c];
        if (svg) body += nested(svg, MARGIN + c * (BIG + GAP), row(r), BIG);
      }
    }
  };
  // Rows: 0 current dailies, 1 monthly dailies, 2 current weekly and on-demand, 3 monthly ditto.
  place(current, [[0, 0]]);
  place(monthly, [[1, 0]]);
  for (let c = 0; c < 7; c += 1) {
    const a = current[8 + c];
    const b = monthly[8 + c];
    if (a) body += nested(a, MARGIN + c * (BIG + GAP), row(2), BIG);
    if (b) body += nested(b, MARGIN + c * (BIG + GAP), row(3), BIG);
  }
  [current, monthly].forEach((svgs, k) => {
    svgs.forEach((svg, i) => {
      body += nested(svg, MARGIN + i * step, smallTop + k * (SMALL + 14), SMALL);
      body += nested(svg, half + MARGIN + i * step, smallTop + k * (SMALL + 14), SMALL);
    });
  });

  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
  const png = new Resvg(sheet, { fitTo: { mode: "original" }, font: RESVG_FONT_OPTIONS })
    .render()
    .asPng();
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}${year}-${two(month)}-${scheme.id}.png`;
  writeFileSync(file, png);
  console.log(file);
}
