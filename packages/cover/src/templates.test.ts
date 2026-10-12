import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { MONTH_NAMES } from "./context.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { PALETTE_IDS } from "./palettes.js";
import { renderCoverSvg, renderSocialSvg } from "./render.js";
import { nonFiniteCount } from "./svg.js";
import { TEMPLATES } from "./templates/index.js";
import type { CoverKind, CoverMeta, CoverSpec, TemplateId } from "./types.js";

const META: CoverMeta = { date: "2026-10-06", kind: "regular", id: "2026-10-06" };
const _WEEKLY: CoverMeta = { date: "2026-10-04", kind: "weekly", id: "2026-10-04-weekly" };
const _EPISODE: CoverMeta = { date: "2026-10-06", kind: "episode", id: "2026-10-06-2" };

/** One fixed palette per template so snapshots cover a spread of looks. */
const SNAPSHOT_PALETTE: Record<TemplateId, string> = {
  spring: "fog-lingonberry",
  dither: "indigo-aqua",
  contour: "sea-lingonberry",
  numeral: "saffron-ink",
  lattice: "ultramarine",
  orbit: "kelp",
  aperture: "marigold-fog",
  band: "plum-pearl",
};

/** Throws unless every opened element is closed in order. Text and attributes are ignored. */
function assertWellFormed(svg: string): void {
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let consumed = 0;
  for (const match of svg.matchAll(tag)) {
    const [whole, closing, name, , selfClosing] = match;
    consumed += whole.length;
    if (selfClosing) continue;
    if (closing) {
      expect(stack.pop(), `unexpected </${name}>`).toBe(name);
    } else {
      stack.push(name as string);
    }
  }
  expect(stack).toEqual([]);
  expect(consumed).toBeGreaterThan(0);
}

function _summarize(svg: string): { sha1: string; bytes: number; elements: number; paths: number } {
  return {
    sha1: createHash("sha1").update(svg).digest("hex"),
    bytes: svg.length,
    elements: (svg.match(/<[A-Za-z]/g) ?? []).length,
    paths: (svg.match(/<path/g) ?? []).length,
  };
}

function thumbnail(svg: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: 64 }, font: RESVG_FONT_OPTIONS }).render()
    .pixels;
}

/** Mean absolute channel difference, 0 to 255. */
function meanDifference(a: Buffer, b: Buffer): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs((a[i] as number) - (b[i] as number));
  return total / a.length;
}

function spec(template: TemplateId, seed: number, palette = SNAPSHOT_PALETTE[template]): CoverSpec {
  return { template, palette, seed };
}

describe.each(TEMPLATES)("template %s", (template) => {
  const svg = renderCoverSvg(spec(template, 1), META);

  it("renders a square, self-contained SVG", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"')).toBe(
      true,
    );
    assertWellFormed(svg);
    // The only URL allowed is the SVG namespace; everything else would be an external reference.
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(
      /https?:|href=|@import|<image|<script|<foreignObject/,
    );
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("carries only the date and the wordmark as text", () => {
    const strings = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    const day = "6";
    const allowed = new Set([...day, "October", "Singularity"]);
    expect(strings.length).toBeGreaterThanOrEqual(3);
    for (const text of strings)
      expect(allowed.has(text as string), `unexpected text "${text}"`).toBe(true);
    expect(strings).toContain("Singularity");
    expect(strings).toContain("October");
    expect(strings).toContain("6");
  });

  it("is deterministic: same input, same bytes", () => {
    expect(renderCoverSvg(spec(template, 1), META)).toBe(svg);
  });

  it("changes with the seed and the palette", () => {
    expect(renderCoverSvg(spec(template, 2), META)).not.toBe(svg);
    const other = PALETTE_IDS.find((id) => id !== SNAPSHOT_PALETTE[template]) as string;
    expect(renderCoverSvg(spec(template, 1, other), META)).not.toBe(svg);
  });

  it("varies in composition across seeds, not only in color", () => {
    // Same palette, different seeds: the rendered pictures must differ materially, not by a hair.
    const thumbs = Array.from({ length: 8 }, (_, i) =>
      thumbnail(renderCoverSvg(spec(template, 100 + i), META)),
    );
    const diffs: number[] = [];
    for (let a = 0; a < thumbs.length; a += 1) {
      for (let b = a + 1; b < thumbs.length; b += 1)
        diffs.push(meanDifference(thumbs[a] as Buffer, thumbs[b] as Buffer));
    }
    diffs.sort((x, y) => x - y);
    expect(diffs[Math.floor(diffs.length / 2)] as number).toBeGreaterThan(1.5);
  });

  it("renders the 1200 by 630 social composition", () => {
    const social = renderSocialSvg(spec(template, 1), META);
    expect(social).toContain('viewBox="0 0 1200 630"');
    assertWellFormed(social);
    expect(social).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe("all templates across all palettes", () => {
  it("never emits a non-finite number", () => {
    const before = nonFiniteCount();
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const palette of PALETTE_IDS) {
        for (const seed of [3, 977, 4_000_000_000]) {
          const svg = renderCoverSvg({ template, palette, seed }, META);
          expect(svg).not.toMatch(/NaN|Infinity|undefined/);
          rendered += 1;
        }
      }
    }
    expect(rendered).toBe(TEMPLATES.length * PALETTE_IDS.length * 3);
    expect(nonFiniteCount()).toBe(before);
  });

  it("holds up across many dates and kinds", () => {
    const before = nonFiniteCount();
    for (let i = 0; i < 160; i += 1) {
      const template = TEMPLATES[i % TEMPLATES.length] as TemplateId;
      const month = String((i % 12) + 1).padStart(2, "0");
      const day = String((i % 28) + 1).padStart(2, "0");
      const meta: CoverMeta = {
        date: `2026-${month}-${day}`,
        kind: (["weekly", "regular", "episode", "regular", "on-demand"] as const)[
          i % 5
        ] as CoverKind,
        id: `2026-${month}-${day}`,
      };
      const svg = renderCoverSvg(
        { template, palette: PALETTE_IDS[i % PALETTE_IDS.length] as string, seed: i * 7919 },
        meta,
      );
      expect(svg).toContain(`>${MONTH_NAMES[Number(month) - 1]}<`);
      assertWellFormed(svg);
      renderSocialSvg(
        { template, palette: PALETTE_IDS[i % PALETTE_IDS.length] as string, seed: i },
        meta,
      );
    }
    expect(nonFiniteCount()).toBe(before);
  });

  it("keeps geometry within a sane distance of the canvas", () => {
    // resvg aborts the whole process on masked content whose bounds run to several canvas widths,
    // so runaway coordinates are a crash waiting to happen, not a cosmetic bug.
    const extent = (svg: string): number => {
      let max = 0;
      for (const attr of svg.matchAll(/ (?:d|points)="([^"]*)"/g)) {
        for (const num of (attr[1] as string).matchAll(/-?\d+\.?\d*/g))
          max = Math.max(max, Math.abs(Number(num[0])));
      }
      return max;
    };
    for (const template of TEMPLATES) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const palette = PALETTE_IDS[seed % PALETTE_IDS.length] as string;
        const worst = Math.max(
          extent(renderCoverSvg({ template, palette, seed: seed * 7919 }, META)),
          extent(renderSocialSvg({ template, palette, seed: seed * 7919 }, META)),
        );
        expect(worst, `${template} seed ${seed * 7919}`).toBeLessThan(3200);
      }
    }
  });

  it("gives every cover its own ids so inline SVGs can share a page", () => {
    const idsOf = (svg: string): string[] =>
      [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1] as string);
    const a = idsOf(renderCoverSvg(spec("aperture", 1), META));
    const b = idsOf(renderCoverSvg(spec("aperture", 2), META));
    expect(a.length).toBeGreaterThan(0);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });
});
