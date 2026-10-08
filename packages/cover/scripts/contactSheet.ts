/**
 * Renders a PNG contact sheet of the cover family into the OS temp directory and prints its path.
 *
 *   npm run covers:sheet
 *
 * Three bands: every template across a spread of palettes, a 60-day run as the Library grid would show
 * it (150px cells), and the weekly and episode variants. The sheet is a review aid, so it is never
 * committed; a path in the temp directory keeps the repo free of generated images.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { RESVG_FONT_OPTIONS } from "../src/fonts.js";
import { allPalettes } from "../src/palettes.js";
import { pickCover } from "../src/pick.js";
import { renderCoverSvg } from "../src/render.js";
import { TEMPLATES } from "../src/templates/index.js";
import type { CoverMeta, CoverSpec } from "../src/types.js";

const GAP = 12;
const BG = "#101114";

interface Cell {
  svg: string;
  size: number;
}

/** Drops the outer svg wrapper's fixed width and height so the cover can be placed at any size. */
function nested(svg: string, x: number, y: number, size: number): string {
  return svg.replace(
    /^<svg ([^>]*?)width="\d+" height="\d+"/,
    `<svg $1x="${x}" y="${y}" width="${size}" height="${size}"`,
  );
}

function band(cells: readonly Cell[], columns: number, top: number, width: number) {
  const parts: string[] = [];
  let x = GAP;
  let y = top;
  let rowHeight = 0;
  let column = 0;
  for (const cell of cells) {
    parts.push(nested(cell.svg, x, y, cell.size));
    rowHeight = Math.max(rowHeight, cell.size);
    x += cell.size + GAP;
    column += 1;
    if (column === columns) {
      column = 0;
      x = GAP;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
  }
  const bottom = column === 0 ? y : y + rowHeight + GAP;
  return { markup: parts.join(""), bottom, width };
}

function metaFor(day: number, kind: CoverMeta["kind"]): CoverMeta {
  const date = new Date(Date.UTC(2026, 8, 1 + day));
  const iso = date.toISOString().slice(0, 10);
  return { date: iso, kind, id: kind === "weekly" ? `${iso}-weekly` : iso };
}

function sheet(): string {
  const palettes = allPalettes();
  const columns = Math.min(palettes.length, 8);
  const big = 220;
  const width = GAP + columns * (big + GAP);

  // Band 1: one row per template, a palette per column, seeds varied down the rows.
  const matrix: Cell[] = [];
  TEMPLATES.forEach((template, row) => {
    for (let c = 0; c < columns; c += 1) {
      const palette = palettes[(c + row * 3) % palettes.length]?.id ?? "";
      const spec: CoverSpec = { template, palette, seed: 1000 + row * 97 + c * 13 };
      matrix.push({ svg: renderCoverSvg(spec, metaFor(3 + row * 3 + c, "regular")), size: big });
    }
  });
  const first = band(matrix, columns, GAP, width);

  // Band 2: 60 consecutive days through the picker, at the Library's thumbnail size.
  const thumb = 150;
  const perRow = Math.floor((width - GAP) / (thumb + GAP));
  const run: Cell[] = [];
  let previous: CoverSpec | undefined;
  for (let day = 0; day < 60; day += 1) {
    const meta = metaFor(day, "regular");
    const spec = pickCover({ ...meta, previous });
    previous = spec;
    run.push({ svg: renderCoverSvg(spec, meta), size: thumb });
  }
  const second = band(run, perRow, first.bottom + GAP, width);

  // Band 3: weekly and on-demand/episode variants.
  const variants: Cell[] = [];
  const kinds = ["weekly", "on-demand", "episode"] as const;
  kinds.forEach((kind, k) => {
    for (let i = 0; i < 4; i += 1) {
      const meta = { ...metaFor(10 + k * 5 + i, "regular"), kind } as CoverMeta;
      const spec = pickCover({ ...meta });
      variants.push({ svg: renderCoverSvg(spec, meta), size: big });
    }
  });
  const third = band(variants, columns, second.bottom + GAP, width);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${third.bottom}" viewBox="0 0 ${width} ${third.bottom}"><rect width="${width}" height="${third.bottom}" fill="${BG}"/>${first.markup}${second.markup}${third.markup}</svg>`;
}

const png = new Resvg(sheet(), { font: RESVG_FONT_OPTIONS }).render().asPng();
const out = join(tmpdir(), "singularity-cover-sheet.png");
writeFileSync(out, png);
console.log(out);
