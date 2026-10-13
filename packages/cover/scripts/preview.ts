/**
 * Contact sheets for the next cover system, one PNG per theme, written to cover-preview/ at the
 * repository root (not committed).
 *
 *   npx tsx packages/cover/scripts/preview.ts
 *
 * Each sheet: 8 dailies, 3 weeklies and 4 on-demand covers at 512px on a ground split light and
 * dark, then one row of the same 15 covers at 48px on each ground.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { RESVG_FONT_OPTIONS } from "../src/fonts.js";
import { renderNextCoverSvg } from "../src/next/layouts.js";
import { themeFor } from "../src/next/themes.js";
import type { NextCoverInput } from "../src/next/types.js";

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
const TITLES = [
  "Why design systems keep drifting",
  "Tokens",
  "The quiet return of the skeuomorphic button",
  "Inside the new view transitions in every browser",
];

const two = (v: number): string => String(v).padStart(2, "0");

function episodes(year: number, month: number): NextCoverInput[] {
  const ym = `${year}-${two(month)}`;
  return [
    ...DAILY_DAYS.map(
      (d): NextCoverInput => ({ kind: "daily", id: `d-${ym}-${two(d)}`, date: `${ym}-${two(d)}` }),
    ),
    ...WEEKLY_DAYS.map(
      (d): NextCoverInput => ({ kind: "weekly", id: `w-${ym}-${two(d)}`, date: `${ym}-${two(d)}` }),
    ),
    ...TITLES.map(
      (title, i): NextCoverInput => ({
        kind: "on_demand",
        id: `o-${ym}-${i}`,
        date: `${ym}-${two(6 + i * 7)}`,
        title,
      }),
    ),
  ];
}

function nested(svg: string, x: number, y: number, size: number): string {
  return svg.replace(
    /width="1024" height="1024"/,
    `x="${x}" y="${y}" width="${size}" height="${size}"`,
  );
}

for (const [year, month] of MONTHS) {
  const theme = themeFor(year, month);
  const list = episodes(year, month);
  const svgs = list.map((e) => renderNextCoverSvg(e));
  const width = MARGIN * 2 + 8 * BIG + 7 * GAP;
  const smallRow = MARGIN + BIG * 2 + GAP * 2 + 40;
  const height = smallRow + SMALL + MARGIN;
  const half = width / 2;
  let body = `<rect width="${half}" height="${height}" fill="${LIGHT}"/><rect x="${half}" width="${half}" height="${height}" fill="${DARK}"/>`;
  svgs.forEach((svg, i) => {
    const row = i < 8 ? 0 : 1;
    const col = i < 8 ? i : i - 8;
    body += nested(svg, MARGIN + col * (BIG + GAP), MARGIN + row * (BIG + GAP), BIG);
  });
  const step = SMALL + 14;
  svgs.forEach((svg, i) => {
    body += nested(svg, MARGIN + i * step, smallRow, SMALL);
    body += nested(svg, half + MARGIN + i * step, smallRow, SMALL);
  });
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
  const png = new Resvg(sheet, { fitTo: { mode: "original" }, font: RESVG_FONT_OPTIONS })
    .render()
    .asPng();
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}${year}-${two(month)}-${theme.id}.png`;
  writeFileSync(file, png);
  console.log(file);
}
