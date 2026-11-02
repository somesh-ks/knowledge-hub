import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_SHAPES, avatarMarkup, moodShapes } from "./avatar";

const css = readFileSync(join(import.meta.dirname, "..", "styles", "avatar.css"), "utf8");

describe("the Avatar's shapes", () => {
  // A mood that names a shape the registry lacks would offer a blank choice in the picker.
  it("are all there for every mood's token list, and each mood has a first one", () => {
    const lists = [...css.matchAll(/--av-shapes:\s*("[^"]*")/g)].map((m) => m[1] ?? "");
    expect(lists.length).toBeGreaterThan(1);
    for (const list of lists) {
      const named = list.replace(/"/g, "").trim().split(/\s+/);
      expect(moodShapes(list), list).toEqual(named);
    }
    for (const def of css.matchAll(/--av-shape-default:\s*([a-z]+)/g)) {
      expect(AVATAR_SHAPES, def[1]).toHaveProperty(def[1] ?? "");
    }
  });

  // A colour written in a shape's markup would escape the hue engine: the shape would stay one colour
  // as the reader turns the hue.
  it("carry no colour of their own, only classes the stylesheet fills from tokens", () => {
    for (const id of Object.keys(AVATAR_SHAPES)) {
      expect(avatarMarkup(id), id).not.toMatch(
        /\b(?:fill|stroke|style)=|#[0-9a-f]{3,8}\b|rgb|oklch/i,
      );
    }
  });
});
