import { describe, expect, it } from "vitest";
import { withRating } from "./sourceRatings";

// The edit panel read its score from the row's data-edit-source, built with the page: a row redrawn with
// a new rating but opened to edit still showed the old one.
describe("withRating", () => {
  it("replaces the rating in a row's edit facts and keeps the rest", () => {
    const facts = JSON.stringify({
      id: "busy",
      name: "Busy",
      score: null,
      label: "New",
      parts: null,
    });
    const next = JSON.parse(
      withRating(facts, {
        score: 4.2,
        label: "Good",
        parts: { health: 1, quality: 0.8, trust: null },
        why: ["Most stories make it"],
      }),
    );
    expect(next).toMatchObject({ id: "busy", name: "Busy", score: 4.2, label: "Good" });
    expect(next.why).toEqual(["Most stories make it"]);
  });

  it("leaves facts it cannot read as they were", () => {
    expect(withRating("{", { score: 1, label: "Poor", parts: null, why: [] })).toBe("{");
  });
});
