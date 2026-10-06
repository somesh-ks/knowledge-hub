import { Resvg } from "@resvg/resvg-js";
import { mixHex } from "./color.js";
import { buildContext } from "./context.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { getPalette } from "./palettes.js";
import { n, rectPath } from "./svg.js";
import { TEMPLATE_FNS, TEMPLATES } from "./templates/index.js";
import type { CoverMeta, CoverSpec } from "./types.js";

const SQUARE = 1024;
const SOCIAL = { w: 1200, h: 630 } as const;

function assertSpec(spec: CoverSpec): void {
  if (!TEMPLATES.includes(spec.template))
    throw new Error(`Unknown cover template "${spec.template}"`);
  getPalette(spec.palette);
  if (!Number.isInteger(spec.seed) || spec.seed < 0) {
    throw new Error(`Cover seed must be a non-negative integer, got ${spec.seed}`);
  }
}

/** The weekly record: art sits inside a ground-colored matte with a hairline rule around it. */
function weeklyFrame(
  w: number,
  h: number,
  u: number,
  text: string,
  ground: string,
  accent: string,
): string {
  const rule = mixHex(ground, text, 0.62);
  const inset = 26 * u;
  const tick = 14 * u;
  const stroke = n(2.2 * u, 2);
  const corners = (
    [
      [inset, inset, 1, 1],
      [w - inset, inset, -1, 1],
      [inset, h - inset, 1, -1],
      [w - inset, h - inset, -1, -1],
    ] as const
  )
    .map(([x, y, dx, dy]) => `M${n(x + dx * tick)} ${n(y)}H${n(x)}V${n(y + dy * tick)}`)
    .join("");
  return (
    `<rect x="${n(inset)}" y="${n(inset)}" width="${n(w - inset * 2)}" height="${n(h - inset * 2)}" fill="none" stroke="${rule}" stroke-width="${stroke}"/>` +
    `<path d="${corners}" fill="none" stroke="${accent}" stroke-width="${n(4 * u, 2)}"/>`
  );
}

function compose(spec: CoverSpec, meta: CoverMeta, w: number, h: number): string {
  assertSpec(spec);
  const { ctx, lockup } = buildContext(spec, meta, w, h);
  const out = TEMPLATE_FNS[spec.template](ctx);
  const { pal, uid, area } = ctx;
  const plateClip = `${uid}p`;
  const defs = `${out.defs ?? ""}${ctx.weekly ? `<clipPath id="${plateClip}"><path d="${rectPath(area)}"/></clipPath>` : ""}`;
  const art = ctx.weekly ? `<g clip-path="url(#${plateClip})">${out.body}</g>` : out.body;
  const type = out.lockup === "own" ? "" : lockup.markup(pal);
  const label = `Dispatch, ${ctx.day} ${ctx.monthName}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">` +
    `<title>${label}</title>` +
    (defs ? `<defs>${defs}</defs>` : "") +
    `<rect width="${w}" height="${h}" fill="${pal.ground}"/>` +
    art +
    (ctx.weekly ? weeklyFrame(w, h, ctx.u, pal.text, pal.ground, pal.accent) : "") +
    type +
    `</svg>`
  );
}

/** Square cover, viewBox 0 0 1024 1024, no external references. */
export function renderCoverSvg(spec: CoverSpec, meta: CoverMeta): string {
  return compose(spec, meta, SQUARE, SQUARE);
}

function rasterize(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: RESVG_FONT_OPTIONS,
  });
  return new Uint8Array(resvg.render().asPng());
}

/** PNG of the square cover at 512 or 1024 pixels. */
export function renderCoverPng(spec: CoverSpec, meta: CoverMeta, size: 512 | 1024): Uint8Array {
  return rasterize(renderCoverSvg(spec, meta), size);
}

/** 1200 by 630 social card, composed for the wide canvas rather than cropped from the square. */
export function renderSocialPng(spec: CoverSpec, meta: CoverMeta): Uint8Array {
  return rasterize(compose(spec, meta, SOCIAL.w, SOCIAL.h), SOCIAL.w);
}

/** The social card as SVG, for the contact sheet. */
export function renderSocialSvg(spec: CoverSpec, meta: CoverMeta): string {
  return compose(spec, meta, SOCIAL.w, SOCIAL.h);
}
