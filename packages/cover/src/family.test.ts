import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToOklch, hexToRgb } from "./color.js";
import { buildContext } from "./context.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { getPalette } from "./palettes.js";
import { renderCoverSvg } from "./render.js";
import { SERIES_STYLES, type Series } from "./series/index.js";
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

  // The monthly styles were drawn around the lockup of one date; a wider week range or numeral on
  // another date could reach under it.
  const SERIES_KIND: Record<Series, CoverKind> = {
    daily: "regular",
    weekly: "weekly",
    "on-demand": "on-demand",
  };
  it.each(Object.keys(SERIES_STYLES) as Series[])(
    "keeps flat ground behind the type on every %s style",
    (series) => {
      const under = new Set<string>();
      for (const date of ["2026-10-01", "2026-11-30", "2027-01-03"]) {
        SERIES_STYLES[series].forEach((style, i) => {
          const spec: CoverSpec = { template: "band", palette: "ultramarine", seed: 31 + i };
          const meta: CoverMeta = { date, kind: SERIES_KIND[series], id: `${date}-${i}` };
          const { ctx } = buildContext(spec, meta, 1024, "standard", true);
          const ground = ctx.matte ?? ctx.pal.ground;
          const out = style(ctx);
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${ground}"/>${out.defs ? `<defs>${out.defs}</defs>` : ""}${out.body}</svg>`;
          const pixels = raster(svg);
          const [gr, gg, gb] = hexToRgb(ground);
          for (const box of [ctx.lockup.date, ctx.lockup.mark]) {
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
                const at = (y * SIZE + x) * 4;
                const off = Math.max(
                  Math.abs((pixels[at] as number) - gr),
                  Math.abs((pixels[at + 1] as number) - gg),
                  Math.abs((pixels[at + 2] as number) - gb),
                );
                if (off > 3) under.add(`${series} style ${i + 1} on ${date}`);
              }
            }
          }
        });
      }
      expect([...under], "art under the type").toEqual([]);
    },
  );

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

  // The first monthly weeklies read as one more daily in a grid. Each series now keeps its own
  // lightness: dark dailies, light on-demand mattes and paper weeklies, in both themes.
  it("keeps every daily darker than the weeklies and on-demand covers of its month", () => {
    const groundL = (kind: CoverKind, month: string, mode: "light" | "dark", seed: number) => {
      const meta: CoverMeta = { date: `${month}-14`, kind, id: `${month}-${seed}`, mode };
      const s: CoverSpec = { template: "band", palette: "ultramarine", seed };
      const { ctx } = buildContext(s, meta, 1024, "standard", true);
      return hexToOklch(ctx.matte ?? ctx.pal.ground).l;
    };
    for (const mode of ["light", "dark"] as const) {
      for (const month of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
        const seeds = Array.from({ length: 40 }, (_, n) => n * 7919 + 13);
        const daily = Math.max(...seeds.map((s) => groundL("regular", month, mode, s)));
        const others = seeds.flatMap((s) => [
          groundL("weekly", month, mode, s),
          groundL("on-demand", month, mode, s),
        ]);
        expect(Math.min(...others) - daily, `${mode} ${month}`).toBeGreaterThanOrEqual(0.1);
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
            const under = ctx.matte ?? ctx.pal.ground;
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
