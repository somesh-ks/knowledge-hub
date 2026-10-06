import type { Category, COVER_TEMPLATES, CoverSpec, DigestKind } from "@dispatch/core";
import type { Rng } from "./prng.js";

/** What the renderer needs to know about the digest, besides the cover spec. */
export interface CoverMeta {
  /** Stockholm calendar date, YYYY-MM-DD. */
  date: string;
  kind: DigestKind;
  id: string;
}

export interface PickInput extends CoverMeta {
  /**
   * Category of the lead item. "watch" is accepted for digests that lead with a video, because
   * watch is a section, not a taste category.
   */
  lead_category?: Category | "watch";
  previous?: { template: string; palette: string };
}

export type TemplateId = (typeof COVER_TEMPLATES)[number];
export type { CoverSpec };

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Corner = "bl" | "br" | "tl" | "tr";
export type Tone = "light" | "dark";

/** A palette resolved to sRGB hex. Roles: ground, quiet field tint, mid shade, focal accent, date text. */
export interface Palette {
  id: string;
  name: string;
  tone: Tone;
  ground: string;
  field: string;
  shade: string;
  accent: string;
  text: string;
}

/** Everything a template may read. Templates are pure functions of this. */
export interface Ctx {
  /** Canvas size. 1024 by 1024 for the cover, 1200 by 630 for the social card. */
  w: number;
  h: number;
  /** Design unit: min(w, h) / 1024. All sizes below are written in units and multiplied by u. */
  u: number;
  rng: Rng;
  seed: number;
  pal: Palette;
  weekly: boolean;
  day: number;
  monthName: string;
  /** Unique per cover so several inline SVGs can share one HTML document. */
  uid: string;
  margin: number;
  /** Corner holding the date lockup. */
  corner: Corner;
  /** Padded rectangles that art must keep clear so type always sits on flat ground. */
  quiet: Rect[];
  /** Drawable area, the full canvas, or the inset plate on weekly covers. */
  area: Rect;
  /** A focal point biased away from the date lockup. */
  focus: Point;
}

export interface TemplateOutput {
  defs?: string;
  body: string;
  /** "standard" adds the date lockup. "own" means the template draws its own date. */
  lockup?: "standard" | "own";
}

export type Template = (ctx: Ctx) => TemplateOutput;
