import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Chromium reports computed colors in the space they were written in, so an OKLCH token comes back as
 * "oklch(...)" rather than "rgb(...)". These helpers convert any CSS color to sRGB in the page, with a
 * canvas, so tests can compare colors by what they look like.
 */
export type Rgb = [number, number, number];

export async function toRgba(page: Page, cssColor: string): Promise<{ rgb: Rgb; alpha: number }> {
  return page.evaluate((value) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2d context");
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
    return { rgb: [red, green, blue] as Rgb, alpha };
  }, cssColor);
}

export async function toRgb(page: Page, cssColor: string): Promise<Rgb> {
  return (await toRgba(page, cssColor)).rgb;
}

export async function computedColor(
  locator: Locator,
  property: "backgroundColor" | "color",
): Promise<string> {
  return locator.first().evaluate((node, name) => getComputedStyle(node)[name], property);
}

/** Asserts a computed color matches an sRGB triple, within rounding. */
export async function expectColor(
  page: Page,
  actual: string,
  expected: Rgb,
  tolerance = 2,
): Promise<void> {
  const rgb = await toRgb(page, actual);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs((rgb[channel] ?? 0) - (expected[channel] ?? 0)),
      `${actual} is rgb(${rgb.join(", ")}), expected rgb(${expected.join(", ")})`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

export const SURFACE_LIGHT: Rgb = [248, 249, 250];
export const SURFACE_DARK: Rgb = [32, 33, 36];
export const ACCENT_LIGHT: Rgb = [25, 103, 210];
export const INK_LIGHT: Rgb = [32, 33, 36];
