import { describe, expect, it } from "vitest";
import { hexToOklch } from "./color.js";
import { coverSwatches } from "./swatches.js";

describe("coverSwatches", () => {
  // On this cover the art is a numeral with a red shadow, drawn as type. Read without fonts, the
  // image was bare paper, and the header light was paper grey under a red cover.
  it("reads the colours of art drawn as type", () => {
    const swatches = coverSwatches(
      { template: "orbit", palette: "plum-pearl", seed: 4040720497 },
      { date: "2026-10-05", kind: "regular", id: "2026-10-05", mode: "dark" },
    );
    expect(swatches.some((s) => hexToOklch(s.hex).c > 0.08)).toBe(true);
    expect(swatches.reduce((sum, s) => sum + s.share, 0)).toBeLessThanOrEqual(1);
  });
});
