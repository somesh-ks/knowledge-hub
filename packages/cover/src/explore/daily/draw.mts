/**
 * Draws the daily style sheets: `tsx draw.mts [outDir]`. Also checks that no style paints inside the
 * date or wordmark boxes, for every day of three months.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import sharp from "../../../../../node_modules/sharp/dist/index.mjs";
import { buildContext } from "../../context.js";
import { RESVG_FONT_OPTIONS } from "../../fonts.js";
import { DAILY_STYLES } from "./index.js";

const OUT = process.argv[2] ?? "/mnt/project-files/cover-palette/variations/daily";
mkdirSync(OUT, { recursive: true });
const SEED = Number(process.env.SEED ?? 11);
const spec = { template: "band", palette: "ultramarine", seed: SEED } as never;

function svgFor(no: number, date: string, withType = true, seed = SEED): string {
  const style = DAILY_STYLES.find((s) => s.no === no);
  if (!style) throw new Error(`no style ${no}`);
  const { ctx } = buildContext(
    { template: "band", palette: "ultramarine", seed } as never,
    { id: "x", date, kind: "regular" },
    1024,
    "standard",
    true,
  );
  const out = style.draw(ctx);
  const type = withType ? ctx.lockup.markup({ ...ctx.pal, text: ctx.ink }, true) : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">` +
    (out.defs ? `<defs>${out.defs}</defs>` : "") +
    `<rect width="1024" height="1024" fill="${ctx.pal.ground}"/>${out.body}${type}</svg>`
  );
}

function png(svg: string, width: number): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: RESVG_FONT_OPTIONS,
  })
    .render()
    .asPng() as Buffer;
}

if (process.env.CHECK) {
  let bad = 0;
  for (const s of DAILY_STYLES) {
    for (const date of ["2026-10-01", "2026-10-13", "2026-11-28", "2026-12-30", "2027-01-17"]) {
      for (const seed of [3, 11, 29, 41, 77, 123]) {
        const { ctx } = buildContext(
          { template: "band", palette: "ultramarine", seed } as never,
          { id: "x", date, kind: "regular" },
          1024,
          "standard",
          true,
        );
        const r = new Resvg(svgFor(s.no, date, false, seed), { font: RESVG_FONT_OPTIONS }).render();
        const px = r.pixels;
        const g = ctx.pal.ground.slice(1);
        const gr = [0, 2, 4].map((i) => Number.parseInt(g.slice(i, i + 2), 16));
        let hit = 0;
        for (const q of ctx.quiet) {
          for (let y = Math.floor(q.y); y < Math.min(1024, q.y + q.h); y += 2) {
            for (let x = Math.floor(q.x); x < Math.min(1024, q.x + q.w); x += 2) {
              const o = (y * 1024 + x) * 4;
              if (px[o] !== gr[0] || px[o + 1] !== gr[1] || px[o + 2] !== gr[2]) hit += 1;
            }
          }
        }
        if (hit) {
          bad += 1;
          console.log(`INTRUDES ${s.no} ${s.name} ${date} seed ${seed}: ${hit} samples`);
        }
      }
    }
  }
  console.log(bad ? `${bad} intrusions` : "quiet boxes clear");
  process.exit(0);
}

const COLS = 5;
const CELL = 240;
const GAP = 22;
const LABEL = 40;

async function sheet(
  dates: readonly string[],
  tiles: readonly (readonly [number, string])[],
  cols: number,
  bg: string,
  fg: string,
  file: string,
  labels: boolean,
): Promise<void> {
  const rows = Math.ceil(tiles.length / cols);
  const w = GAP + cols * (CELL + GAP);
  const h = GAP + rows * (CELL + (labels ? LABEL : 0) + GAP);
  const layers: { input: Buffer; left: number; top: number }[] = [];
  let labelSvg = "";
  tiles.forEach(([no, date], i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const left = GAP + c * (CELL + GAP);
    const top = GAP + r * (CELL + (labels ? LABEL : 0) + GAP);
    layers.push({ input: png(svgFor(no, date), CELL), left, top });
    if (labels) {
      const name = DAILY_STYLES.find((s) => s.no === no)?.name ?? "";
      labelSvg += `<text x="${left}" y="${top + CELL + 27}" font-family="Schibsted Grotesk" font-weight="500" font-size="19" fill="${fg}">${String(no).padStart(2, "0")}  ${name}</text>`;
    }
  });
  const base = sharp({ create: { width: w, height: h, channels: 3, background: bg } });
  const text = png(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${labelSvg}</svg>`,
    w,
  );
  await base
    .composite([...layers, { input: text, left: 0, top: 0 }])
    .png()
    .toFile(`${OUT}/${file}`);
  console.log("wrote", file, w, h, dates.length);
}

const all = DAILY_STYLES.map((s) => [s.no, "2026-10-13"] as const);
await sheet(["2026-10-13"], all, COLS, "#0b1220", "#e8edf3", "sheet-dark.png", true);
await sheet(["2026-10-13"], all, COLS, "#f6f8f9", "#1a2230", "sheet-light.png", true);

const months = ["2026-10-13", "2026-11-13", "2026-12-13", "2027-01-13"];
const grid = DAILY_STYLES.flatMap((s) => months.map((d) => [s.no, d] as const));
await sheet(months, grid, 4, "#0b1220", "#e8edf3", "sheet-months.png", false);

if (process.env.LARGE) {
  for (const no of String(process.env.LARGE).split(",").map(Number)) {
    writeFileSync(`${OUT}/large-${no}.png`, png(svgFor(no, "2026-10-13"), 1024));
  }
}
void spec;
