import { describe, expect, it } from "vitest";
import { morphPath, pickReaction } from "./avatarReactions";

// A tap steps through the mood's list from where the hue starts it: a reader who taps twice never sees
// the same act twice in a row, and two hues do not open with the same one (D353).
describe("a tap's reaction", () => {
  const plays = ["wave", "scout", "wink", "wow", "morph"];

  it("steps on with each tap and wraps", () => {
    const seen = [0, 1, 2, 3, 4, 5].map((tap) => pickReaction(plays, 0, tap));
    expect(seen).toEqual(["wave", "scout", "wink", "wow", "morph", "wave"]);
  });

  it("starts at a different place for a different hue", () => {
    expect(pickReaction(plays, 0, 0)).not.toBe(pickReaction(plays, 120, 0));
  });

  it("copes with a negative or full-turn hue and an empty list", () => {
    expect(plays).toContain(pickReaction(plays, -45, 0));
    expect(pickReaction(plays, 360, 0)).toBe(pickReaction(plays, 0, 0));
    expect(pickReaction([], 90, 3)).toBe("hop");
  });
});

describe("a morph's path", () => {
  const offered = ["cookie", "flower", "clover", "sunny", "burst"];

  it("passes through other shapes and ends at home", () => {
    const path = morphPath(offered, "cookie", 0, 0);
    expect(path.at(-1)).toBe("cookie");
    expect(path.slice(0, -1).every((id) => id !== "cookie")).toBe(true);
    expect(path.length).toBeGreaterThan(1);
  });

  it("still comes home when the mood offers only the one shape", () => {
    expect(morphPath(["cookie"], "cookie", 200, 4)).toEqual(["cookie"]);
  });
});
