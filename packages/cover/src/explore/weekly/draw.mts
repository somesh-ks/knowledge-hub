/**
 * Draws the paper weekly styles: contact sheets for each theme and across months, plus a check that
 * the wordmark and date sit on flat paper. Run with
 * `node_modules/.bin/tsx packages/cover/src/explore/weekly/draw.mts [outDir]`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { buildContext } from "../../context.js";
import { RESVG_FONT_OPTIONS } from "../../fonts.js";
import type { CoverMode } from "../../mode.js";
import { type Paper, paper } from "./kit.js";
import { STYLES, type Style } from "./styles.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, "out");
mkdirSync(outDir, { recursive: true });

const MONTHS = [
  { label: "Oct", date: "2026-10-11" },
  { label: "Nov", date: "2026-11-15" },
  { label: "Dec", date: "2026-12-13" },
  { label: "Jan", date: "2027-01-10" },
] as const;

const colors = (date: string, mode: CoverMode): Paper => paper(date, mode);

function cover(style: Style, date: string, mode: CoverMode, seed = 1) {
  const { ctx } = buildContext(
    { template: "band", palette: "ultramarine", seed } as never,
    { id: "x", date, kind: "weekly" },
    1024,
    "standard",
    true,
  );
  const c = colors(date, mode);
  const bare = `<g transform="scale(${ctx.u})">${style.draw(c, ctx.rng)}</g>`;
  const full = `<svg width="1024" height="1024" viewBox="0 0 1024 1024">${bare}${ctx.lockup.markup({ ...ctx.pal, text: c.K }, true)}</svg>`;
  return { full, bare, ground: c.P, quiet: ctx.quiet };
}

const svgOf = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${inner}</svg>`;
const render = (svg: string, width: number): Resvg =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, font: RESVG_FONT_OPTIONS });

for (const [i, s] of STYLES.entries()) {
  for (const m of MONTHS) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const c = cover(s, m.date, "light", seed);
      const px = render(svgOf(c.bare), 1024).render().pixels;
      const want = [1, 3, 5].map((k) => Number.parseInt(c.ground.slice(k, k + 2), 16));
      let bad = 0;
      for (const r of c.quiet) {
        for (let y = Math.floor(r.y); y < r.y + r.h; y += 3) {
          for (let x = Math.floor(r.x); x < r.x + r.w; x += 3) {
            const o = (y * 1024 + x) * 4;
            if (px[o] !== want[0] || px[o + 1] !== want[1] || px[o + 2] !== want[2]) bad += 1;
          }
        }
      }
      if (bad > 0)
        console.log(`QUIET ${i + 1} ${s.name} ${m.label} seed ${seed}: ${bad} samples off paper`);
    }
  }
}

const TILE = 240;
const GAP = 32;
const LABEL = 30;
const id = (i: number): string => String(i + 1).padStart(2, "0");

function sheet(mode: CoverMode, page: string, text: string, sub: string): string {
  const cols = 5;
  const w = GAP + cols * (TILE + GAP);
  const h = GAP + Math.ceil(STYLES.length / cols) * (TILE + LABEL + GAP);
  const parts = [`<rect width="${w}" height="${h}" fill="${page}"/>`];
  STYLES.forEach((s, i) => {
    const x = GAP + (i % cols) * (TILE + GAP);
    const y = GAP + Math.floor(i / cols) * (TILE + LABEL + GAP);
    parts.push(
      `<g transform="translate(${x} ${y}) scale(${TILE / 1024})">${cover(s, MONTHS[0].date, mode).full}</g>`,
      `<text x="${x}" y="${y + TILE + 22}" font-size="15" font-weight="700" fill="${text}">${id(i)}</text>`,
      `<text x="${x + 28}" y="${y + TILE + 22}" font-size="15" font-weight="500" fill="${sub}">${s.name}</text>`,
    );
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Schibsted Grotesk">${parts.join("")}</svg>`;
}

writeFileSync(
  join(outDir, "sheet-light.png"),
  render(sheet("light", "#f6f8f9", "#0b1220", "#44505e"), 1392)
    .render()
    .asPng(),
);
writeFileSync(
  join(outDir, "sheet-dark.png"),
  render(sheet("dark", "#0b1220", "#f2f5f8", "#b4bfcc"), 1392)
    .render()
    .asPng(),
);

{
  const lab = 210;
  const w = GAP + lab + MONTHS.length * (TILE + GAP);
  const head = 56;
  const h = head + STYLES.length * (TILE + GAP / 2) + GAP;
  const parts = [`<rect width="${w}" height="${h}" fill="#f6f8f9"/>`];
  MONTHS.forEach((m, j) => {
    parts.push(
      `<text x="${GAP + lab + j * (TILE + GAP)}" y="36" font-size="20" font-weight="700" fill="#0b1220">${m.label}</text>`,
    );
  });
  STYLES.forEach((s, i) => {
    const y = head + i * (TILE + GAP / 2);
    parts.push(
      `<text x="${GAP}" y="${y + 40}" font-size="30" font-weight="900" fill="#0b1220">${id(i)}</text>`,
      `<text x="${GAP}" y="${y + 68}" font-size="15" font-weight="500" fill="#44505e">${s.name}</text>`,
    );
    MONTHS.forEach((m, j) => {
      const x = GAP + lab + j * (TILE + GAP);
      parts.push(
        `<g transform="translate(${x} ${y}) scale(${TILE / 1024})">${cover(s, m.date, "light").full}</g>`,
      );
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Schibsted Grotesk">${parts.join("")}</svg>`;
  writeFileSync(join(outDir, "sheet-months.png"), render(svg, w).render().asPng());
}
console.log("done");
