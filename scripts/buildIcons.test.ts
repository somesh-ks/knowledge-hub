import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBrandColors } from "../apps/web/src/lib/brandColors";
import { buildIcons, faviconSvg, ICON_SPECS, iconSvg, renderIcon } from "./buildIcons";

const TOKENS = join(import.meta.dirname, "..", "apps", "web", "src", "styles", "tokens.css");
const colors = parseBrandColors(readFileSync(TOKENS, "utf8"));
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("app icons", () => {
  it("reads the surface and accent colors from the generated tokens", () => {
    expect(colors.surfaceLight).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors.accentLight).not.toBe(colors.surfaceLight);
  });

  it("draws every icon in the accent color on the surface color", () => {
    const svg = iconSvg(colors, 180, 0.56);
    expect(svg).toContain(`fill="${colors.surfaceLight}"`);
    expect(svg).toContain(`fill="${colors.accentLight}"`);
  });

  for (const spec of ICON_SPECS) {
    it(`renders ${spec.file} at ${spec.size}px with no transparency`, () => {
      const icon = renderIcon(iconSvg(colors, spec.size, spec.markShare), spec.size);
      expect(pngSize(icon.png)).toEqual({ width: spec.size, height: spec.size });
      for (let index = 3; index < icon.pixels.length; index += 4) {
        if (icon.pixels[index] !== 255) throw new Error(`Pixel ${(index - 3) / 4} is not opaque`);
      }
    });
  }

  it("keeps the maskable mark inside the central safe zone", () => {
    const maskable = ICON_SPECS.find((spec) => spec.file === "icon-maskable-512.png");
    // The rail's ends are half the mark height from the center; the circle radius is 40 percent.
    expect((maskable?.markShare ?? 1) / 2).toBeLessThanOrEqual(0.4);
  });

  it("makes a favicon that follows the color scheme", () => {
    const svg = faviconSvg(colors);
    expect(svg).toContain(colors.accentLight);
    expect(svg).toContain(colors.accentDark);
    expect(svg).toContain("prefers-color-scheme:dark");
  });

  it("writes the icon files", () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatch-icons-"));
    temporary.push(directory);
    const written = buildIcons(directory, TOKENS);
    expect(written).toEqual(expect.arrayContaining(["apple-touch-icon.png", "favicon.svg"]));
    expect(readdirSync(directory).sort()).toEqual([...written].sort());
  });
});
