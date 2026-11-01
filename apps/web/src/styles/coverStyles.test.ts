import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COVER_STYLES } from "@singularity/cover";
import { expect, it } from "vitest";
import tokens from "../../../../tokens/tokens.json" with { type: "json" };

const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");

// The bug this prevents: a style the app lists (tokens.json) but the covers do not know draws Default's
// covers under it, and a style the covers know but the stylesheets do not name shows two or three
// covers stacked, or none, in that style only. CSS cannot be looped over, so each style is named by hand
// in the rules that choose its cover and its light.
it("draws a cover for every style the app has, and names it where the page chooses", () => {
  const appStyles = Object.keys(tokens.styles)
    .filter((id) => !id.startsWith("$"))
    .sort();
  expect([...COVER_STYLES].filter((style) => style !== "default").sort()).toEqual(appStyles);
  const cover = read("cover.css").replace(/\s+/g, " ");
  const ambient = read("ambient.css");
  for (const style of appStyles) {
    expect(cover, style).toContain(`[data-style="${style}"] .cover .cover-image`);
    expect(ambient, style).toContain(`--ambient-a-l-${style}`);
  }
});
