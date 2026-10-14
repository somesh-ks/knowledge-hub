import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { hexToRgb } from "./color.js";
import { RESVG_FONT_OPTIONS } from "./fonts.js";
import { getPalette } from "./palettes.js";
import { renderCoverPng, renderCoverSvg, renderSocialPng } from "./render.js";
import { assertSchemes } from "./season.js";
import type { CoverMeta, CoverSpec } from "./types.js";

const META: CoverMeta = { date: "2026-09-06", kind: "regular", id: "2026-09-06" };
const SPEC: CoverSpec = { template: "contour", palette: "fog-lingonberry", seed: 42 };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function dimensions(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("PNG output", () => {
  it.each([512, 1024] as const)("renders a valid square PNG at %i", (size) => {
    const png = renderCoverPng(SPEC, META, size);
    expect([...png.slice(0, 8)]).toEqual(SIGNATURE);
    expect(dimensions(png)).toEqual({ width: size, height: size });
  });

  it("renders the social card at 1200 by 630", () => {
    const png = renderSocialPng(SPEC, META);
    expect([...png.slice(0, 8)]).toEqual(SIGNATURE);
    expect(dimensions(png)).toEqual({ width: 1200, height: 630 });
  });

  it("signs the large cover and leaves the signature off the small one", () => {
    const raster = (svg: string, width: number): Buffer =>
      Buffer.from(
        new Resvg(svg, { fitTo: { mode: "width", value: width }, font: RESVG_FONT_OPTIONS })
          .render()
          .asPng(),
      );
    expect(renderCoverSvg(SPEC, META)).toContain(">Singularity</text>");
    expect(renderCoverSvg(SPEC, META, { wordmark: false })).not.toContain(">Singularity</text>");
    expect(
      Buffer.from(renderCoverPng(SPEC, META, 512)).equals(
        raster(renderCoverSvg(SPEC, META, { wordmark: false }), 512),
      ),
    ).toBe(true);
    expect(
      Buffer.from(renderCoverPng(SPEC, META, 1024)).equals(
        raster(renderCoverSvg(SPEC, META), 1024),
      ),
    ).toBe(true);
  });

  it("is deterministic: same input, same bytes", () => {
    expect(
      Buffer.from(renderCoverPng(SPEC, META, 512)).equals(
        Buffer.from(renderCoverPng(SPEC, META, 512)),
      ),
    ).toBe(true);
    expect(
      Buffer.from(renderSocialPng(SPEC, META)).equals(Buffer.from(renderSocialPng(SPEC, META))),
    ).toBe(true);
  });

  it("rasterizes the bundled typeface: the date draws in the palette's text color", () => {
    const pal = getPalette("fog-lingonberry");
    const [r, g, b] = hexToRgb(pal.text);
    const { pixels } = new Resvg(renderCoverSvg(SPEC, META), {
      font: RESVG_FONT_OPTIONS,
    }).render();
    let exact = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b) exact += 1;
    }
    // A 264 px numeral plus the month and wordmark put thousands of solid pixels in the text color.
    expect(exact).toBeGreaterThan(4000);
  });
});

describe("fonts", () => {
  it("never reads system fonts, so output is the same on every machine", () => {
    expect(RESVG_FONT_OPTIONS.loadSystemFonts).toBe(false);
  });
});

describe("renderCoverSvg", () => {
  it("rejects unknown templates, unknown palettes, bad seeds and bad dates", () => {
    expect(() => renderCoverSvg({ ...SPEC, template: "nope" as never }, META)).toThrow(/template/);
    expect(() => renderCoverSvg({ ...SPEC, palette: "nope" }, META)).toThrow(/palette/);
    expect(() => renderCoverSvg({ ...SPEC, seed: -1 }, META)).toThrow(/seed/);
    expect(() => renderCoverSvg({ ...SPEC, seed: 1.5 }, META)).toThrow(/seed/);
    expect(() => renderCoverSvg(SPEC, { ...META, date: "soon" })).toThrow(/date/i);
  });

  it("sets the date from the digest, not the spec", () => {
    const a = renderCoverSvg(SPEC, META);
    const b = renderCoverSvg(SPEC, { ...META, date: "2026-08-23", id: "2026-08-23" });
    expect(a).toContain(">September<");
    expect(b).toContain(">August<");
    expect(b).toContain(">2<");
    expect(b).toContain(">3<");
  });

  it("frames weekly covers differently from regular ones", () => {
    const weeklyMeta: CoverMeta = { date: "2026-09-04", kind: "weekly", id: "2026-09-04-weekly" };
    const weekly = renderCoverSvg({ ...SPEC, palette: "sea-lingonberry" }, weeklyMeta);
    const regular = renderCoverSvg(
      { ...SPEC, palette: "sea-lingonberry" },
      { ...weeklyMeta, kind: "regular" },
    );
    expect(weekly).toMatch(/<rect [^>]*fill="none" stroke=/);
    expect(regular).not.toMatch(/<rect [^>]*fill="none" stroke=/);
    expect(weekly).toContain("clip-path");
    expect(weekly.length).toBeGreaterThan(regular.length);
    // The matte around the plate is flat ground.
    expect(weekly).toContain(`fill="${getPalette("sea-lingonberry").ground}"`);
  });

  it("describes itself for assistive tech without adding visible text", () => {
    const svg = renderCoverSvg(SPEC, META);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Singularity, 6 September"');
  });
});

describe("monthly style", () => {
  it("applies from the first monthly month on, decided by the cover's own date", () => {
    const meta = { ...META, id: "x" };
    const before = renderCoverSvg(SPEC, { ...meta, date: "2026-09-30" });
    const after = renderCoverSvg(SPEC, { ...meta, date: "2026-10-01" });
    expect(before).toBe(renderCoverSvg(SPEC, { ...meta, date: "2026-09-30" }, { monthly: false }));
    expect(after).toBe(renderCoverSvg(SPEC, { ...meta, date: "2026-10-01" }, { monthly: true }));
    expect(after).not.toBe(before);
  });

  it("leaves every scheme a legal colour dress for every kind", () => {
    expect(() => assertSchemes()).not.toThrow();
  });
});
