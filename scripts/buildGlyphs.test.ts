import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPageRegistry,
  buildPlayerRegistry,
  GENERATED_HEADER,
  type GlyphDocument,
  isGenerated,
  loadGlyphs,
  PAGE_REGISTRY_PATH,
  PLAYER_REGISTRY_PATH,
  pathFromSvg,
  validateGlyphs,
} from "./buildGlyphs.js";

const doc = loadGlyphs();

function withGlyph(name: string, glyph: Partial<GlyphDocument["glyphs"][string]>): GlyphDocument {
  return {
    ...doc,
    glyphs: {
      [name]: { symbol: "close", targets: ["page"], d: "M0 0h24Z", ...glyph },
    },
  };
}

describe("glyph source", () => {
  it("is sound: names, symbols, targets and paths", () => {
    expect(validateGlyphs(doc)).toEqual([]);
  });

  it("records where the paths came from", () => {
    expect(doc.source).toContain("@material-symbols/svg-400");
    expect(doc.sourceVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.viewBox).toBe("0 -960 960 960");
  });

  it("gives a filled twin to each navigation icon, for the active destination", () => {
    for (const name of ["home", "archive", "settings"]) {
      const outline = doc.glyphs[name];
      const filled = doc.glyphs[`${name}Fill`];
      expect(outline?.fill ?? false, name).toBe(false);
      expect(filled?.fill, `${name}Fill`).toBe(true);
      expect(filled?.symbol).toBe(outline?.symbol);
      expect(filled?.d).not.toBe(outline?.d);
    }
  });

  it("names what is wrong with a bad glyph", () => {
    expect(validateGlyphs(withGlyph("Bad-Name", {}))).toEqual(["Bad-Name: name is not camelCase"]);
    expect(validateGlyphs(withGlyph("ok", { symbol: "Play Arrow" }))).toEqual([
      'ok: symbol "Play Arrow"',
    ]);
    expect(validateGlyphs(withGlyph("ok", { targets: [] }))).toEqual(["ok: no target"]);
    expect(validateGlyphs(withGlyph("ok", { d: "" }))).toEqual([
      "ok: path is missing or malformed",
    ]);
    // Markup or script can never ride along in a path.
    expect(validateGlyphs(withGlyph("ok", { d: 'M0 0"/><script>' }))).toEqual([
      "ok: path is missing or malformed",
    ]);
  });
});

describe("pathFromSvg", () => {
  it("reads the single path of a Material Symbols file", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -960 960 960"><path d="M320-203v-560l440 280-440 280Z"/></svg>';
    expect(pathFromSvg(svg)).toBe("M320-203v-560l440 280-440 280Z");
  });

  it("refuses a file with no path or with several", () => {
    expect(() => pathFromSvg("<svg></svg>")).toThrow(/one path/);
    expect(() => pathFromSvg('<svg><path d="M0 0"/><path d="M1 1"/></svg>')).toThrow(/one path/);
  });
});

describe("generated registries", () => {
  it("builds the page registry deterministically, sorted by name", () => {
    const source = buildPageRegistry(doc);
    expect(buildPageRegistry(loadGlyphs())).toBe(source);
    expect(source).toContain(GENERATED_HEADER);
    const names = [...source.matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((match) => match[1]);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("openInNew");
    // A glyph that only the player uses stays out of the page bundle.
    expect(names).not.toContain("replay10");
  });

  it("matches the committed page registry", () => {
    expect(existsSync(PAGE_REGISTRY_PATH), "run npm run glyphs").toBe(true);
    expect(readFileSync(PAGE_REGISTRY_PATH, "utf8")).toBe(buildPageRegistry(doc));
  });

  it("matches the committed player registry once that file is generated", () => {
    const committed = readFileSync(PLAYER_REGISTRY_PATH, "utf8");
    // Until the player adopts this set its registry is hand-written, and this script leaves it be.
    if (!isGenerated(committed)) return;
    expect(committed).toBe(buildPlayerRegistry(doc));
  });

  it("keeps every line the formatter would keep", () => {
    for (const line of buildPageRegistry(doc).split("\n")) {
      // Only a path string may run past the line width; nothing else in the file may.
      if (line.length > 100) expect(line.trim()).toMatch(/^(?:[a-zA-Z0-9]+: )?"[Mm]/);
    }
  });
});
