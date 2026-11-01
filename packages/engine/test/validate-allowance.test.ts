import { describe, expect, it } from "vitest";
import { trimOverAllowance, withinAllowances } from "../src/run/validateStage.js";
import { DEFAULT_SECTION_PLAN } from "../src/score/sectionPlan.js";
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

// 2026-10-31: the refill wrote three Tech stories for a Tech allowance already full, and
// validation trimmed all three. It offers a section only the room its allowance has left, plus one
// spare while any room is left, since a story can still be lost in writing.
describe("withinAllowances", () => {
  const reserved = (...ids: string[]) => ids.map((id) => ({ id }));
  const ownerOf = (entry: { id: string }) => (entry.id.startsWith("t") ? "tech" : "ui-craft");

  it("skips Tech stories once Tech's allowance is used, and keeps the main sections' stories", () => {
    const airing = Array.from({ length: 5 }, () => "tech");
    const kept = withinAllowances(
      reserved("t1", "t2", "m1", "m2"),
      airing,
      ownerOf,
      DEFAULT_SECTION_PLAN,
      3,
    );
    expect(kept.map((e) => e.id)).toEqual(["m1", "m2"]);
  });

  it("offers a Tech story and one spare when one slot is left, so a lost story can be replaced", () => {
    const airing = ["tech", "tech", "tech", "tech", "ui-craft"];
    const kept = withinAllowances(
      reserved("t1", "t2", "t3", "m1"),
      airing,
      ownerOf,
      DEFAULT_SECTION_PLAN,
      3,
    );
    expect(kept.map((e) => e.id)).toEqual(["t1", "t2", "m1"]);
  });

  // D297: a briefing the allowances would leave under the floor takes the capped stories it needs.
  describe("under the floor", () => {
    const techOne = { ...DEFAULT_SECTION_PLAN, limit: (s: string) => (s === "tech" ? 1 : null) };

    it("follows with capped Tech stories, as many as the floor needs and one spare", () => {
      const kept = withinAllowances(
        reserved("t1", "t2", "t3"),
        ["tech", "ui-craft"],
        ownerOf,
        techOne,
        3,
      );
      expect(kept.map((e) => e.id)).toEqual(["t1", "t2"]);
    });

    it("prefers stories that fit, and offers capped ones only for what is still missing", () => {
      const withMain = withinAllowances(
        reserved("t1", "m1"),
        ["tech", "ui-craft"],
        ownerOf,
        techOne,
        3,
      );
      expect(withMain.map((e) => e.id)).toEqual(["m1"]);
    });
  });
});
