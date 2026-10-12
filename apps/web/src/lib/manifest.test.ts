import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrandColors, readBrandColors } from "./brandColors";
import { buildManifest } from "./manifest";

const TOKENS = join(import.meta.dirname, "..", "styles", "tokens.css");
const colors = readBrandColors(TOKENS);

describe("parseBrandColors", () => {
  it("reads the surface and accent values from the generated footer", () => {
    const css = `
 * theme-color and manifest background (surface): light #F8F9FA, dark #202124
 * accent: light #1967D2, dark #8AB4F8`;
    expect(parseBrandColors(css)).toEqual({
      surfaceLight: "#f8f9fa",
      surfaceDark: "#202124",
      accentLight: "#1967d2",
      accentDark: "#8ab4f8",
    });
  });

  it("fails loudly when the footer is missing", () => {
    expect(() => parseBrandColors(":root {}")).toThrow(/buildTokens/);
  });
});

describe("buildManifest", () => {
  const manifest = buildManifest(colors);

  it("lists PNG icons at 192 and 512 plus a maskable one", () => {
    expect(manifest.icons.every((icon) => icon.type === "image/png")).toBe(true);
    const sizes = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
    expect(sizes).toEqual(["192x192", "512x512"]);
    expect(manifest.icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
  });
});
