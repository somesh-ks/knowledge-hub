import { Resvg } from "@resvg/resvg-js";
import { buildContext } from "../../context.js";
import { FONT_STACK, RESVG_FONT_OPTIONS } from "../../fonts.js";
import type { CoverSpec } from "../../types.js";
import { STYLES } from "./index.js";

/**
 * Draws the catalogue: every on-demand style in one season's dress, as contact sheets. Run it with
 * `tsx draw.ts <out dir>`. Not wired into the picker or the renderer.
 */

const SIZE = 1024;

/** One cover as an inline svg fragment (no outer svg), for a style and a date. */
function cover(index: number, spec: CoverSpec, date: string): string {
  const style = STYLES[index];
  if (!style) throw new Error(`No style ${index}`);
  const meta = { id: "x", date, kind: "on-demand" as const };
  const { ctx } = buildContext(spec, meta, SIZE, "standard", true);
  const out = style.fn(ctx);
  const type = ctx.lockup.markup({ ...ctx.pal, text: ctx.ink }, false);
  const tag = `${ctx.uid}${index}`;
  const body = (out.defs ? `<defs>${out.defs}</defs>` : "") + out.body;
  // Clip ids repeat across dates, so namespace them per tile.
  return (
    `<rect width="${SIZE}" height="${SIZE}" fill="${ctx.matte ?? ctx.pal.ground}"/>` +
    body +
    type
  ).replaceAll(ctx.uid, tag);
}

function tile(svg: string, x: number, y: number, size: number, round: number): string {
  const k = size / SIZE;
  return (
    `<g transform="translate(${x} ${y}) scale(${k})"><clipPath id="r${x}-${y}"><rect width="${SIZE}" height="${SIZE}" rx="${round / k}"/></clipPath>` +
    `<g clip-path="url(#r${x}-${y})">${svg}</g></g>`
  );
}

function label(
  text: string,
  x: number,
  y: number,
  fill: string,
  size = 15,
  anchor = "start",
): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-weight="600" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${text}</text>`;
}

function png(svg: string, w: number, h: number): Uint8Array {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg>`;
  return new Resvg(doc, { fitTo: { mode: "width", value: w }, font: RESVG_FONT_OPTIONS })
    .render()
    .asPng();
}

export function grid(spec: CoverSpec, date: string, page: string, ink: string): Uint8Array {
  const size = 240;
  const gap = 22;
  const pad = 24;
  const cell = size + 34;
  const w = pad * 2 + 5 * size + 4 * gap;
  const h = pad * 2 + 4 * cell + 3 * (gap - 10) - 0;
  let out = `<rect width="${w}" height="${h}" fill="${page}"/>`;
  STYLES.forEach((style, i) => {
    const x = pad + (i % 5) * (size + gap);
    const y = pad + Math.floor(i / 5) * (cell + gap - 10);
    out += tile(cover(i, spec, date), x, y, size, 10);
    out += label(`${style.id}  ${style.name}`, x + 2, y + size + 22, ink);
  });
  return png(out, w, h);
}

export function months(spec: CoverSpec, dates: string[], page: string, ink: string): Uint8Array {
  const size = 200;
  const gap = 14;
  const pad = 24;
  const left = 190;
  const w = pad * 2 + left + 4 * size + 3 * gap;
  const h = pad * 2 + 20 * size + 19 * gap;
  let out = `<rect width="${w}" height="${h}" fill="${page}"/>`;
  STYLES.forEach((style, i) => {
    const y = pad + i * (size + gap);
    out += label(`${style.id}  ${style.name}`, pad, y + size / 2 + 5, ink, 18);
    dates.forEach((date, j) => {
      out += tile(cover(i, spec, date), pad + left + j * (size + gap), y, size, 8);
    });
  });
  return png(out, w, h);
}

if (process.argv[1]?.endsWith("draw.ts")) {
  const { writeFileSync } = await import("node:fs");
  const dir = process.argv[2] ?? ".";
  const seed = Number(process.argv[3] ?? 7);
  const spec: CoverSpec = { template: "spring", palette: "ultramarine", seed };
  writeFileSync(`${dir}/sheet-dark.png`, grid(spec, "2026-10-11", "#0b1220", "#cfd8e6"));
  writeFileSync(`${dir}/sheet-light.png`, grid(spec, "2026-10-11", "#f6f8f9", "#26303d"));
  writeFileSync(
    `${dir}/sheet-months.png`,
    months(spec, ["2026-10-11", "2026-11-11", "2026-12-11", "2027-01-11"], "#f6f8f9", "#26303d"),
  );
}
