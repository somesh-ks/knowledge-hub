import { n } from "../../svg.js";
import { circle } from "../../templates/kit.js";
import type { Ctx, TemplateOutput } from "../../types.js";

/** The colours a plate cover may draw in: matte, disc, art, shade, field and type ink. */
export function pen(ctx: Ctx) {
  const { pal } = ctx;
  return {
    M: ctx.matte ?? pal.ground,
    G: pal.ground,
    A: pal.accent,
    S: pal.shade,
    F: pal.field,
    I: ctx.ink,
    rng: ctx.rng,
    uid: ctx.uid,
  };
}

/** The old disc's centre and radius, in canvas px at 1024. Art keeps above the date. */
export const CX = 512;
export const CY = 400;
export const R = 280;

export const P = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;

/** A half disc on the flat edge y; `up` curves it upward. */
export const dome = (x: number, y: number, r: number, fill: string, up = true): string =>
  P(`M${n(x - r)} ${n(y)}A${n(r)} ${n(r)} 0 0 ${up ? 1 : 0} ${n(x + r)} ${n(y)}Z`, fill);

/** A doorway standing on y = base. */
export const arch = (x: number, top: number, base: number, width: number, fill: string): string => {
  const h = width / 2;
  return P(
    `M${n(x - h)} ${n(base)}V${n(top + h)}A${n(h)} ${n(h)} 0 0 1 ${n(x + h)} ${n(top + h)}V${n(base)}Z`,
    fill,
  );
};

/** The overlap of two discs of radius r whose centres are 2*d apart on the x axis, centred on (x, y). */
export const lens = (x: number, y: number, r: number, d: number, fill: string): string => {
  const h = Math.sqrt(r * r - d * d);
  return P(
    `M${n(x)} ${n(y - h)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y - h)}Z`,
    fill,
  );
};

/** Content clipped to a shape, which needs one clipPath id per cover. */
export function clipped(id: string, shape: string, content: string): TemplateOutput {
  return {
    defs: `<clipPath id="${id}">${shape}</clipPath>`,
    body: `<g clip-path="url(#${id})">${content}</g>`,
  };
}

/** The classic disc: its own flat colour, with art clipped inside. */
export function onDisc(ctx: Ctx, tag: string, content: string, r = R): TemplateOutput {
  const { G } = pen(ctx);
  const out = clipped(`${ctx.uid}${tag}`, `<circle cx="${CX}" cy="${CY}" r="${r}"/>`, content);
  return { defs: out.defs, body: circle(CX, CY, r, G) + out.body };
}
