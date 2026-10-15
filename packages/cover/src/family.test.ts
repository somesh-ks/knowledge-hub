import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb } from "./color.js";
import { buildContext, WEEKLY_INSET } from "./context.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { getPalette } from "./palettes.js";
import { renderCoverSvg } from "./render.js";
import { TEMPLATE_LOCKUP, TEMPLATES } from "./templates/index.js";
import type { CoverKind, CoverMeta, CoverSpec, Rect, TemplateId } from "./types.js";

const KINDS: readonly CoverKind[] = ["regular", "weekly", "episode", "on-demand"];
const SIZE = 256;
const SCALE = SIZE / 1024;

function metaFor(kind: CoverKind, day: number): CoverMeta {
  const date = `2026-05-${String(((day - 1) % 28) + 1).padStart(2, "0")}`;
  return { date, kind, id: kind === "regular" ? date : `${date}-${kind}` };
}

function raster(svg: string, width = SIZE): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: RESVG_FONT_OPTIONS,
  }).render().pixels;
}

/** Removes the lockup type, leaving only the art. A numeral that is the art keeps its digits. */
function withoutType(svg: string, own: boolean): string {
  return svg.replace(/<text[^>]*>([^<]*)<\/text>/g, (whole, content: string) =>
    own && /^\d$/.test(content) ? whole : "",
  );
}

function lockupBoxes(spec: CoverSpec, meta: CoverMeta) {
  const mode = TEMPLATE_LOCKUP[spec.template];
  const { ctx } = buildContext(spec, meta, 1024, mode);
  const boxes: Rect[] =
    mode === "own" ? [ctx.lockup.mark, ctx.lockup.month] : [ctx.lockup.date, ctx.lockup.mark];
  return { boxes, ground: ctx.pal.ground, margin: ctx.margin };
}

function meanDifference(a: Buffer, b: Buffer): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs((a[i] as number) - (b[i] as number));
  return total / a.length;
}

describe("lockup legibility", () => {
  // The palette tests hold the type at 4.5:1 against the ground. This proves the ground is what sits
  // behind it: no art, on any template, kind or seed, reaches under the date or the wordmark.
  const palettes = ["ultramarine", "fog-lingonberry", "oxblood", "ink-bone", "lichen"];

  it.each(TEMPLATES)("keeps flat ground behind the type on %s", (template) => {
    for (const kind of KINDS) {
      palettes.forEach((palette, p) => {
        for (const seed of [11 + p, 4099 + p]) {
          const spec: CoverSpec = { template, palette, seed };
          const meta = metaFor(kind, 5 + p * 6);
          const { boxes, ground } = lockupBoxes(spec, meta);
          const [gr, gg, gb] = hexToRgb(ground);
          const svg = withoutType(renderCoverSvg(spec, meta), TEMPLATE_LOCKUP[template] === "own");
          const pixels = raster(svg);
          for (const box of boxes) {
            for (
              let y = Math.floor(box.y * SCALE);
              y < Math.ceil((box.y + box.h) * SCALE);
              y += 1
            ) {
              for (
                let x = Math.floor(box.x * SCALE);
                x < Math.ceil((box.x + box.w) * SCALE);
                x += 1
              ) {
                const i = (y * SIZE + x) * 4;
                const off = Math.max(
                  Math.abs((pixels[i] as number) - gr),
                  Math.abs((pixels[i + 1] as number) - gg),
                  Math.abs((pixels[i + 2] as number) - gb),
                );
                if (off > 3) {
                  throw new Error(
                    `${template} ${kind} ${palette} seed ${seed}: art under type at ${x},${y}`,
                  );
                }
              }
            }
          }
        }
      });
    }
  });

  it("draws the lockup inside the safe margins and inside its own ink boxes", () => {
    for (const template of TEMPLATES.filter((t) => TEMPLATE_LOCKUP[t] === "standard")) {
      for (const kind of KINDS) {
        const spec: CoverSpec = { template, palette: "ultramarine", seed: 99 };
        const meta = metaFor(kind, 28);
        const { boxes, margin } = lockupBoxes(spec, meta);
        const svg = renderCoverSvg(spec, meta);
        const withType = raster(svg);
        const bare = raster(withoutType(svg, false));
        const slack = 3;
        for (let y = 0; y < SIZE; y += 1) {
          for (let x = 0; x < SIZE; x += 1) {
            const i = (y * SIZE + x) * 4;
            if (
              withType[i] === bare[i] &&
              withType[i + 1] === bare[i + 1] &&
              withType[i + 2] === bare[i + 2]
            ) {
              continue;
            }
            const px = x / SCALE;
            const py = y / SCALE;
            const inMargin =
              px >= margin - slack &&
              py >= margin - slack &&
              px <= 1024 - margin + slack &&
              py <= 1024 - margin + slack;
            const inBox = boxes.some(
              (b) =>
                px >= b.x - slack &&
                px <= b.x + b.w + slack &&
                py >= b.y - slack &&
                py <= b.y + b.h + slack,
            );
            if (!inMargin || !inBox) {
              throw new Error(
                `${template} ${kind}: type ink at ${px},${py} is outside its box or margin`,
              );
            }
          }
        }
      }
    }
  });
});

describe("the family", () => {
  it("has at least six templates that read as different pictures at thumbnail size", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const thumbs = TEMPLATES.map((template) =>
      raster(
        renderCoverSvg({ template, palette: "ultramarine", seed: 5 }, metaFor("regular", 6)),
        64,
      ),
    );
    for (let a = 0; a < thumbs.length; a += 1) {
      for (let b = a + 1; b < thumbs.length; b += 1) {
        expect(
          meanDifference(thumbs[a] as Buffer, thumbs[b] as Buffer),
          `${TEMPLATES[a]} vs ${TEMPLATES[b]}`,
        ).toBeGreaterThan(6);
      }
    }
  });

  it("draws every template with exact geometry: no filters, gradients, masks or opacity", () => {
    for (const template of TEMPLATES) {
      for (const kind of KINDS) {
        const svg = renderCoverSvg({ template, palette: "kelp", seed: 77 }, metaFor(kind, 9));
        expect(svg, `${template} ${kind}`).not.toMatch(/<filter|Gradient|<mask|<pattern|opacity/);
      }
    }
  });

  it("puts the figure color on the art", () => {
    const pal = getPalette("oxblood");
    for (const template of TEMPLATES) {
      const svg = renderCoverSvg({ template, palette: "oxblood", seed: 8 }, metaFor("regular", 6));
      expect(svg, template).toContain(pal.accent);
    }
  });
});

describe("variants", () => {
  const spec = (template: TemplateId): CoverSpec => ({
    template,
    palette: "ultramarine",
    seed: 21,
  });

  it("presses an episode the other way round: the figure color becomes the ground", () => {
    const pal = getPalette("ultramarine");
    for (const template of TEMPLATES) {
      const regular = renderCoverSvg(spec(template), metaFor("regular", 6));
      const episode = renderCoverSvg(spec(template), metaFor("episode", 6));
      expect(regular, template).toContain(
        `<rect width="1024" height="1024" fill="${pal.ground}"/>`,
      );
      expect(episode, template).toContain(
        `<rect width="1024" height="1024" fill="${pal.accent}"/>`,
      );
    }
  });

  it("gives weeklies a matte and rule that regular covers and episodes never have", () => {
    for (const template of TEMPLATES) {
      const weekly = renderCoverSvg(spec(template), metaFor("weekly", 6));
      expect(weekly, template).toMatch(/<rect [^>]*fill="none" stroke=/);
      expect(weekly, template).toContain("clip-path");
      for (const kind of ["regular", "episode", "on-demand"] as const) {
        expect(renderCoverSvg(spec(template), metaFor(kind, 6)), `${template} ${kind}`).not.toMatch(
          /<rect [^>]*fill="none" stroke=/,
        );
      }
    }
  });

  // The month's schemes dressed weeklies and dailies alike, so a weekly read as one more daily in a grid.
  it("mounts a monthly weekly on a matte that stands off its plate in grayscale", () => {
    for (const month of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const s: CoverSpec = { template: "band", palette: "ultramarine", seed: seed * 7919 };
        const meta: CoverMeta = { date: `${month}-14`, kind: "weekly", id: `${month}-w${seed}` };
        const { ctx } = buildContext(s, meta, 1024, "standard", true);
        const where = `${month} seed ${seed}`;
        expect(ctx.matte, where).toBeDefined();
        expect(contrastRatio(ctx.matte ?? "", ctx.pal.ground), where).toBeGreaterThanOrEqual(2);
        // The matte is drawn: a pixel halfway into it carries its colour.
        const px = raster(renderCoverSvg(s, meta));
        const at = (Math.round(SIZE / 2) * SIZE + Math.round((WEEKLY_INSET * SCALE) / 2)) * 4;
        expect([px[at], px[at + 1], px[at + 2]], where).toEqual(hexToRgb(ctx.matte ?? ""));
        const daily = buildContext(s, { ...meta, kind: "regular" }, 1024, "standard", true);
        expect(daily.ctx.matte, where).toBeUndefined();
      }
    }
  });

  // Toning a cover for the dark page darkened a terracotta ground under dark type to 3.7:1.
  it("keeps the date legible on every cover drawn for the light and the dark theme", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const month of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
        for (const kind of ["regular", "weekly", "episode"] as const) {
          for (let n = 0; n < 60; n += 1) {
            const seed = n * 7919 + 13;
            const s: CoverSpec = { template: "band", palette: "ultramarine", seed };
            const meta: CoverMeta = { date: `${month}-14`, kind, id: `${month}-${seed}`, mode };
            const { ctx } = buildContext(s, meta, 1024, "standard", true);
            const under = ctx.plate && ctx.matte ? ctx.matte : ctx.pal.ground;
            expect(
              contrastRatio(ctx.ink, under),
              `${mode} ${month} ${kind} ${seed}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("treats on-demand like a regular briefing", () => {
    const strip = (svg: string): string => svg.replace(/c[0-9a-z]{4,8}/g, "");
    const a = renderCoverSvg(spec("orbit"), { ...metaFor("regular", 6), id: "x" });
    const b = renderCoverSvg(spec("orbit"), { ...metaFor("on-demand", 6), id: "x" });
    expect(strip(b)).toBe(strip(a));
  });
});
