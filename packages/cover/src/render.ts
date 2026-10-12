import { Resvg } from "@resvg/resvg-js";
import { buildContext, WEEKLY_INSET } from "./context.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { getPalette } from "./palettes.js";
import { n, rectPath } from "./svg.js";
import { TEMPLATE_FNS, TEMPLATE_LOCKUP, TEMPLATES } from "./templates/index.js";
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

/**
 * The weekly record: the art is a plate inside a matte of flat ground, ringed by a figure-colored
 * rule. The matte alone shows at thumbnail size; the rule is for the large cover.
 */
function weeklyFrame(size: number, u: number, figure: string): string {
  const inset = (WEEKLY_INSET / 2) * u;
  return `<rect x="${n(inset)}" y="${n(inset)}" width="${n(size - inset * 2)}" height="${n(size - inset * 2)}" fill="none" stroke="${figure}" stroke-width="${n(3 * u, 2)}"/>`;
}

interface Composed {
  /** Everything inside the outer svg element, sized `size` by `size`. */
  inner: string;
  ground: string;
  label: string;
}

function compose(spec: CoverSpec, meta: CoverMeta, size: number, wordmark = true): Composed {
  assertSpec(spec);
  const mode = TEMPLATE_LOCKUP[spec.template];
  const { ctx } = buildContext(spec, meta, size, mode);
  const out = TEMPLATE_FNS[spec.template](ctx);
  const { pal, uid, area } = ctx;
  const weekly = ctx.variant === "weekly";
  const plateClip = `${uid}p`;
  const defs = `${out.defs ?? ""}${weekly ? `<clipPath id="${plateClip}"><path d="${rectPath(area)}"/></clipPath>` : ""}`;
  const art = weekly ? `<g clip-path="url(#${plateClip})">${out.body}</g>` : out.body;
  const type =
    mode === "own" ? ctx.lockup.topLine(pal, wordmark) : ctx.lockup.markup(pal, wordmark);
  const label = `Singularity, ${ctx.day} ${ctx.monthName}`;
  const inner =
    (defs ? `<defs>${defs}</defs>` : "") +
    `<rect width="${size}" height="${size}" fill="${pal.ground}"/>` +
    art +
    (weekly ? weeklyFrame(size, ctx.u, pal.accent) : "") +
    type;
  return { inner, ground: pal.ground, label };
}

function wrap(size: { w: number; h: number }, composed: Composed, body: string): string {
  const { label } = composed;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" role="img" aria-label="${label}">` +
    `<title>${label}</title>${body}</svg>`
  );
}

export interface CoverSvgOptions {
  /** Draw the "Singularity" signature in the top corner. On by default. */
  wordmark?: boolean;
}

/** Square cover, viewBox 0 0 1024 1024, no external references. */
export function renderCoverSvg(
  spec: CoverSpec,
  meta: CoverMeta,
  options: CoverSvgOptions = {},
): string {
  const composed = compose(spec, meta, SQUARE, options.wordmark ?? true);
  return wrap({ w: SQUARE, h: SQUARE }, composed, composed.inner);
}

function rasterize(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: RESVG_FONT_OPTIONS,
  });
  return new Uint8Array(resvg.render().asPng());
}

/**
 * PNG of the square cover at 512 or 1024 pixels. The 512 leaves the wordmark out: it is the image of
 * every card, row and thumbnail, where the signature's letters are a few pixels tall and read as
 * noise, while the date still reads. The 1024 is the player's and the podcast's artwork and keeps it.
 */
export function renderCoverPng(spec: CoverSpec, meta: CoverMeta, size: 512 | 1024): Uint8Array {
  return rasterize(renderCoverSvg(spec, meta, { wordmark: size >= 1024 }), size);
}

/**
 * The 1200 by 630 social card as SVG: the square cover at full height on a wider field of its own
 * ground color, so the art is never cropped and the link preview still reads as the same record.
 */
export function renderSocialSvg(spec: CoverSpec, meta: CoverMeta): string {
  const composed = compose(spec, meta, SOCIAL.h);
  const x = (SOCIAL.w - SOCIAL.h) / 2;
  const body =
    `<rect width="${SOCIAL.w}" height="${SOCIAL.h}" fill="${composed.ground}"/>` +
    `<g transform="translate(${n(x)} 0)">${composed.inner}</g>`;
  return wrap(SOCIAL, composed, body);
}

/** 1200 by 630 social card. */
export function renderSocialPng(spec: CoverSpec, meta: CoverMeta): Uint8Array {
  return rasterize(renderSocialSvg(spec, meta), SOCIAL.w);
}
