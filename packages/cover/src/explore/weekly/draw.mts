/**
 * Draws the weekly explorations: contact sheets and a quiet-zone check. Run with
 * `node_modules/.bin/tsx packages/cover/src/explore/weekly/draw.mts [outDir]`.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { buildContext } from "../../context.js";
import { RESVG_FONT_OPTIONS } from "../../fonts.js";
import type { Template } from "../../types.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? join(here, "out");
mkdirSync(outDir, { recursive: true });

interface Style {
  id: string;
  name: string;
  fn: Template;
}

const files = readdirSync(here)
  .filter((f) => /^\d\d-.*\.ts$/.test(f))
  .sort();
const styles: Style[] = [];
for (const f of files) {
  const mod = (await import(join(here, f))) as { name: string; weekly: Template };
  styles.push({ id: f.slice(0, 2), name: mod.name, fn: mod.weekly });
}

const MONTHS = [
  { label: "Oct", date: "2026-10-11" },
  { label: "Nov", date: "2026-11-15" },
  { label: "Dec", date: "2026-12-13" },
  { label: "Jan", date: "2027-01-10" },
] as const;

function build(date: string, seed = 1) {
  const spec = { template: "band", palette: "ultramarine", seed } as never;
  return buildContext(spec, { id: "x", date, kind: "weekly" }, 1024, "standard", true).ctx;
}

/** The cover as inner markup on the 1024 canvas, and the same without the lockup. */
function cover(
  style: Style,
  date: string,
  seed = 1,
): {
  full: string;
  bare: string;
  ground: string;
  quiet: { x: number; y: number; w: number; h: number }[];
} {
  const ctx = build(date, seed);
  const out = style.fn(ctx);
  const bare = `<rect width="1024" height="1024" fill="${ctx.matte ?? ctx.pal.ground}"/>${out.defs ? `<defs>${out.defs}</defs>` : ""}${out.body}`;
  const full = bare + ctx.lockup.markup({ ...ctx.pal, text: ctx.ink }, true);
  return { full, bare, ground: ctx.pal.ground, quiet: ctx.quiet };
}

const svgOf = (inner: string, size = 1024): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">${inner}</svg>`;

function render(svg: string, width: number): Resvg {
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, font: RESVG_FONT_OPTIONS });
}

// Quiet-zone check: the ground must stay flat behind the wordmark and the date.
for (const s of styles) {
  const c = cover(s, MONTHS[0].date);
  const img = render(svgOf(c.bare), 1024).render();
  const px = img.pixels;
  const want = [1, 3, 5].map((i) => Number.parseInt(c.ground.slice(i, i + 2), 16));
  let bad = 0;
  for (const r of c.quiet) {
    for (let y = Math.floor(r.y); y < r.y + r.h; y += 3) {
      for (let x = Math.floor(r.x); x < r.x + r.w; x += 3) {
        const o = (y * 1024 + x) * 4;
        if (px[o] !== want[0] || px[o + 1] !== want[1] || px[o + 2] !== want[2]) bad += 1;
      }
    }
  }
  if (bad > 0) console.log(`QUIET ${s.id} ${s.name}: ${bad} samples off ground`);
}

const TILE = 240;
const GAP = 32;
const LABEL = 30;

function sheet(page: string, text: string, sub: string, mute: string): string {
  const cols = 5;
  const rows = Math.ceil(styles.length / cols);
  const w = GAP + cols * (TILE + GAP);
  const h = GAP + rows * (TILE + LABEL + GAP);
  const parts = [`<rect width="${w}" height="${h}" fill="${page}"/>`];
  styles.forEach((s, i) => {
    const x = GAP + (i % cols) * (TILE + GAP);
    const y = GAP + Math.floor(i / cols) * (TILE + LABEL + GAP);
    parts.push(
      `<g transform="translate(${x} ${y}) scale(${TILE / 1024})">${cover(s, MONTHS[0].date).full}</g>`,
      `<text x="${x}" y="${y + TILE + 22}" font-size="15" font-weight="700" fill="${text}">${s.id}</text>`,
      `<text x="${x + 28}" y="${y + TILE + 22}" font-size="15" font-weight="500" fill="${sub}">${s.name}</text>`,
    );
  });
  void mute;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Schibsted Grotesk">${parts.join("")}</svg>`;
}

writeFileSync(
  join(outDir, "sheet-dark.png"),
  render(sheet("#0b1220", "#f2f5f8", "#b4bfcc", ""), 1392)
    .render()
    .asPng(),
);
writeFileSync(
  join(outDir, "sheet-light.png"),
  render(sheet("#f6f8f9", "#0b1220", "#44505e", ""), 1392)
    .render()
    .asPng(),
);

// Months: styles as rows, four months as columns.
{
  const lab = 210;
  const w = GAP + lab + MONTHS.length * (TILE + GAP);
  const head = 56;
  const h = head + styles.length * (TILE + GAP / 2) + GAP;
  const parts = [`<rect width="${w}" height="${h}" fill="#0b1220"/>`];
  MONTHS.forEach((m, j) => {
    parts.push(
      `<text x="${GAP + lab + j * (TILE + GAP)}" y="36" font-size="20" font-weight="700" fill="#f2f5f8">${m.label}</text>`,
    );
  });
  styles.forEach((s, i) => {
    const y = head + i * (TILE + GAP / 2);
    parts.push(
      `<text x="${GAP}" y="${y + 40}" font-size="30" font-weight="900" fill="#f2f5f8">${s.id}</text>`,
      `<text x="${GAP}" y="${y + 68}" font-size="15" font-weight="500" fill="#b4bfcc">${s.name}</text>`,
    );
    MONTHS.forEach((m, j) => {
      const x = GAP + lab + j * (TILE + GAP);
      parts.push(
        `<g transform="translate(${x} ${y}) scale(${TILE / 1024})">${cover(s, m.date).full}</g>`,
      );
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Schibsted Grotesk">${parts.join("")}</svg>`;
  writeFileSync(join(outDir, "sheet-months.png"), render(svg, w).render().asPng());
}

// Check sheet at 170px in grayscale-ready form (the caller converts); also a large single per style.
{
  const t = 170;
  const cols = 10;
  const rows = Math.ceil(styles.length / cols);
  const w = 16 + cols * (t + 16);
  const h = 16 + rows * (t + 16);
  const parts = [`<rect width="${w}" height="${h}" fill="#808080"/>`];
  styles.forEach((s, i) => {
    const x = 16 + (i % cols) * (t + 16);
    const y = 16 + Math.floor(i / cols) * (t + 16);
    parts.push(
      `<g transform="translate(${x} ${y}) scale(${t / 1024})">${cover(s, MONTHS[0].date).full}</g>`,
    );
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
  writeFileSync(join(outDir, "check-170.png"), render(svg, w).render().asPng());
}
console.log(`drew ${styles.length} styles to ${outDir}`);
