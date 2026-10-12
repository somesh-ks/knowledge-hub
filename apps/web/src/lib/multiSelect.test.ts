import { describe, expect, it } from "vitest";
import { chosenSummary, joinLabels } from "./multiSelect";

describe("chosenSummary", () => {
  it("names every option chosen in one phrase, and joins fewer", () => {
    const all = ["Daily", "Weekly", "Episodes"];
    expect(chosenSummary(all, 3, "All podcasts", "In no podcast")).toBe("All podcasts");
    expect(chosenSummary(["Daily", "Weekly"], 3, "All podcasts")).toBe("Daily and Weekly");
    expect(chosenSummary([], 3, "All podcasts", "In no podcast")).toBe("In no podcast");
    // A field with no word for all of them joins them all.
    expect(chosenSummary(all, 3)).toBe(joinLabels(all));
  });
});
