import { describe, expect, it } from "vitest";
import { trimOverAllowance } from "../src/run/validateStage.js";
import type { ValidationIssue } from "../src/validate/validateDigest.js";

const story = (id: string) => ({ item: { id } });
const over = (itemIds: string[], excess: number): ValidationIssue => ({
  severity: "error",
  code: "item_count",
  message: `${itemIds.length} Tech releases items; the limit is ${itemIds.length - excess}.`,
  overAllowance: { section: "tech", itemIds, excess },
});

// The refill wrote four Tech releases stories for a limit of one; the stage threw and the
// briefing aired 4 of 8 stories (2026-10-27). It now gives up the lowest-ranked of the section.
describe("trimOverAllowance", () => {
  const scores = new Map([
    ["a", 0.9],
    ["b", 0.4],
    ["c", 0.7],
    ["d", 0.2],
    ["main", 0.1],
  ]);
  const scoreOf = (s: { item: { id: string } }): number => scores.get(s.item.id) ?? 0;

  it("cuts the lowest-scored of an over-full section and leaves other sections alone", () => {
    const survivors = ["a", "b", "c", "d", "main"].map(story);
    const cut = trimOverAllowance([over(["a", "b", "c", "d"], 3)], survivors, scoreOf);
    expect([...cut].sort()).toEqual(["b", "c", "d"]);
  });

  it("cuts nothing when no section is over", () => {
    const issue: ValidationIssue = { severity: "error", code: "voice", message: "x", itemId: "a" };
    expect(trimOverAllowance([issue], ["a", "b"].map(story), scoreOf).size).toBe(0);
  });
});
