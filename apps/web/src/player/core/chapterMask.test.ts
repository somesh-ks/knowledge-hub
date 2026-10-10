import { describe, expect, it } from "vitest";
import { chapterMask } from "./chapterMask";

describe("the timeline's chapter gaps", () => {
  it("cuts one gap at each story start after the first, in order", () => {
    const mask = chapterMask([0.5, 0, 0.25]) ?? "";
    expect(mask.match(/transparent calc\(25\.000% - /g)).toHaveLength(1);
    expect(mask.indexOf("25.000%")).toBeLessThan(mask.indexOf("50.000%"));
    expect(mask).not.toMatch(/calc\(0\.000%/);
  });

  it("has nothing to cut for one story", () => {
    expect(chapterMask([0])).toBeUndefined();
    expect(chapterMask([])).toBeUndefined();
  });
});
