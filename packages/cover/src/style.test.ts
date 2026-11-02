import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STYLE_RULES } from "./style.js";

/**
 * The page recolours covers from `--cover-*` in tokens.css; the contrast tests (live.test.ts) run
 * the rule in code. They are one rule only if the CSS holds the rule's numbers: a style edited in
 * covers.json and not rebuilt would otherwise draw one look and be proved on another.
 */
describe("tokens.css holds each style's cover numbers", () => {
  const css = readFileSync(
    new URL("../../../apps/web/src/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const readIn = (block: RegExp, style: string, property: string): number => {
    for (const match of css.matchAll(block)) {
      const found = new RegExp(`--cover-${property}: ([-\\d.]+);`).exec(match[1] ?? "");
      if (found) return Number(found[1]);
    }
    throw new Error(`tokens.css has no --cover-${property} for ${style}`);
  };
  const read = (style: string, property: string): number =>
    readIn(new RegExp(`:root\\[data-style="${style}"\\] \\{([^}]*)\\}`, "g"), style, property);
  // A style's dark bounds are written twice: for the system theme and for a reader's chosen dark.
  const readDark = (style: string, property: string, chosen: boolean): number =>
    readIn(
      new RegExp(
        `${chosen ? ':root\\[data-theme="dark"\\]' : ':root:not\\(\\[data-theme="light"\\]\\)'}\\[data-style="${style}"\\] \\{([^}]*)\\}`,
        "g",
      ),
      style,
      property,
    );

  for (const [style, rule] of STYLE_RULES) {
    it(`${style}`, () => {
      expect(read(style, "hue")).toBe(rule.hue);
      expect(read(style, "keep")).toBe(rule.keep);
      expect(read(style, "spread")).toBe(rule.spread);
      expect(read(style, "cap")).toBe(rule.cap);
      expect(read(style, "hold")).toBe(rule.hold);
      expect(read(style, "c-scale")).toBe(rule.chroma.scale);
      expect(read(style, "c-add")).toBe(rule.chroma.add);
      expect(read(style, "c-max")).toBe(rule.chroma.max);
      expect(read(style, "c-floor-below")).toBe(rule.chroma.floorBelow);
      expect(read(style, "c-floor")).toBe(rule.chroma.floor);
      expect(read(style, "flip")).toBe(rule.flip ? 1 : 0);
      expect(read(style, "lo")).toBe(rule.flip?.light[0] ?? 0);
      expect(read(style, "hi")).toBe(rule.flip?.light[1] ?? 1);
      expect(read(style, "night-below")).toBe(rule.night?.below ?? 0);
      expect(read(style, "night-hue")).toBe(rule.night?.hue ?? 0);
      expect(read(style, "night-c")).toBe(rule.night?.chroma ?? 0);
      if (rule.flip) {
        for (const chosen of [false, true]) {
          expect(readDark(style, "lo", chosen)).toBe(rule.flip.dark[0]);
          expect(readDark(style, "hi", chosen)).toBe(rule.flip.dark[1]);
        }
      }
    });
  }
});
