import { describe, expect, it } from "vitest";
import { hintsFor } from "./regenHints";

const labels = ["Design systems", "AI tools", "Accessibility"];

describe("hintsFor (D337)", () => {
  // The bug it prevents: the form opening with every control, or the length control never
  // appearing for a person who writes "make it shorter".
  it("calls for the length control only when the words reach for it", () => {
    expect(hintsFor("", labels)).toEqual({ length: false, topics: false });
    expect(hintsFor("More on the new release", labels).length).toBe(false);
    expect(hintsFor("make it shorter", labels).length).toBe(true);
    expect(hintsFor("about 10 minutes please", labels).length).toBe(true);
  });

  it("calls for categories by a cue word or by naming one", () => {
    expect(hintsFor("skip the funding news", labels).topics).toBe(true);
    expect(hintsFor("more accessibility", labels).topics).toBe(true);
    expect(hintsFor("talk about design systems", labels).topics).toBe(true);
    expect(hintsFor("clearer summaries", labels).topics).toBe(false);
  });

  // The bug it prevents: a Regenerate with no categories (a toast's Details) showing a control with nothing in it.
  it("never calls for categories when none are on offer", () => {
    expect(hintsFor("skip the funding news, only design systems")).toEqual({
      length: false,
      topics: false,
    });
  });
});
