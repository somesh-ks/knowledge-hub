import type { Category, COVER_TEMPLATES, CoverSpec, DigestKind } from "@singularity/core";
import type { LockupLayout } from "./lockup.js";
import type { CoverMode } from "./mode.js";
import type { Rng } from "./prng.js";

/**
 * What a record is. The digest kinds plus "episode", a briefing the user made on request, which the
 * digest schema does not carry yet but the cover already presses differently.
 */
export type CoverKind = DigestKind | "episode";

/** How a cover is dressed: briefings plain, weeklies matted and framed, episodes inverted. */
export type Variant = "regular" | "weekly" | "episode" | "plate";

/** What the renderer needs to know about the digest, besides the cover spec. */
export interface CoverMeta {
  /** Stockholm calendar date, YYYY-MM-DD. */
  date: string;
  kind: CoverKind;
  id: string;
  /** The app theme the cover is drawn for. Left out, the colours are drawn as authored. */
  mode?: CoverMode;
  /** The app style the cover is drawn for (D311). Left out, or Default, the month's own colours. */
  style?: string;
}

export interface PickInput extends CoverMeta {
  /**
   * Category of the lead item. "watch" is accepted for digests that lead with a video, because
   * watch is a section, not a taste category.
   */
  lead_category?: Category | "watch";
  previous?: { template: string; palette: string };
  /**
   * Older covers, most recent first, after `previous`. When given, the picker also avoids their
   * templates and palettes so a run of neighbours in a grid rarely shares one.
   */
  recent?: ReadonlyArray<{ template: string; palette: string }>;
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

export type Tone = "light" | "dark";

/**
 * A palette resolved to sRGB hex. Roles: flat ground, a quiet field tint and a mid shade (both
 * derived), the figure color (3:1 or better on the ground) and the lockup text (4.5:1 or better).
 */
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
  /** Canvas size: always square. The social card composes the square on a wider ground. */
  w: number;
  h: number;
  /** Design unit: min(w, h) / 1024. All sizes below are written in units and multiplied by u. */
  u: number;
  rng: Rng;
  seed: number;
  /** Already dressed for the variant, so an episode arrives with ground and figure swapped. */
  pal: Palette;
  variant: Variant;
  day: number;
  monthName: string;
  /** The date numeral: the day of the month, or "W42" on a weekly. */
  numeral: string;
  /** Small line under the numeral: the month, or a weekly's date range. */
  caption: string;
  /** Color of the lockup type. */
  ink: string;
  /** The flat ground of a monthly on-demand cover, which the art and type sit on. */
  matte?: string;
  /** Unique per cover so several inline SVGs can share one HTML document. */
  uid: string;
  margin: number;
  /** Padded rectangles that art must keep clear so type always sits on flat ground. */
  quiet: Rect[];
  /** Drawable area: the full canvas, or the inset plate on a framed weekly. */
  area: Rect;
  /** Where the date numeral and wordmark go, for a template that draws its own date. */
  lockup: LockupLayout;
}

export interface TemplateOutput {
  defs?: string;
  body: string;
}

export type Template = (ctx: Ctx) => TemplateOutput;
