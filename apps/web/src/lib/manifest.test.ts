import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrandColors, readBrandColors } from "./brandColors";
import { buildManifest } from "./manifest";

const TOKENS = join(import.meta.dirname, "..", "styles", "tokens.css");
const colors = readBrandColors(TOKENS);

describe("parseBrandColors", () => {
  it("reads the surface and accent values from the generated footer", () => {
    const css = `
 * theme-color and manifest background (surface): light #F4F8FB, dark #0A1119
 * accent: light #AB2442, dark #F36D7F`;
    expect(parseBrandColors(css)).toEqual({
      surfaceLight: "#f4f8fb",
      surfaceDark: "#0a1119",
      accentLight: "#ab2442",
      accentDark: "#f36d7f",
    });
  });

  it("fails loudly when the footer is missing", () => {
    expect(() => parseBrandColors(":root {}")).toThrow(/buildTokens/);
  });

  it("matches the committed tokens.css", () => {
    expect(colors.surfaceLight).toBe("#f4f8fb");
    expect(colors.surfaceDark).toBe("#0a1119");
    expect(readFileSync(TOKENS, "utf8")).toContain(colors.accentLight);
  });
});

describe("buildManifest", () => {
  const manifest = buildManifest(colors);

  it("is a standalone app rooted at the site", () => {
    expect(manifest).toMatchObject({
      name: "Dispatch",
      short_name: "Dispatch",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("uses the surface color for the splash and the tab", () => {
    expect(manifest.background_color).toBe(colors.surfaceLight);
    expect(manifest.theme_color).toBe(colors.surfaceLight);
  });

  it("lists PNG icons at 192 and 512 plus a maskable one", () => {
    expect(manifest.icons.every((icon) => icon.type === "image/png")).toBe(true);
    const sizes = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
    expect(sizes).toEqual(["192x192", "512x512"]);
    expect(manifest.icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
  });

  it("names the icon files the icon script writes", () => {
    const names = manifest.icons.map((icon) => icon.src);
    expect(names).toEqual(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]);
  });
});
