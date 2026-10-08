import { describe, expect, it } from "vitest";
import {
  addDeleted,
  DELETED_FAILED_AFTER_MS,
  DELETED_MAX_AGE_MS,
  parseDeleted,
  pruneDeleted,
} from "./deletedEpisodes";

const NOW = 1_000_000_000;
const MIN = 60_000;

describe("deleted episodes", () => {
  it("adds an id once, with the time", () => {
    const list = addDeleted(addDeleted([], "a", NOW - MIN), "a", NOW);
    expect(list).toEqual([{ id: "a", at: NOW }]);
  });

  it("expires an entry after an hour", () => {
    const list = [{ id: "a", at: NOW - DELETED_MAX_AGE_MS - 1 }];
    expect(pruneDeleted(list, null, NOW)).toEqual([]);
    expect(pruneDeleted([{ id: "a", at: NOW - 5 * MIN }], null, NOW)).toHaveLength(1);
  });

  it("drops an entry whose card is gone from the Library", () => {
    const list = [{ id: "a", at: NOW - MIN }];
    expect(pruneDeleted(list, new Set(["b"]), NOW)).toEqual([]);
    expect(pruneDeleted(list, new Set(["a"]), NOW)).toEqual(list);
  });

  it("shows the episode again if its card is still there after ten minutes", () => {
    const old = [{ id: "a", at: NOW - DELETED_FAILED_AFTER_MS - 1 }];
    expect(pruneDeleted(old, new Set(["a"]), NOW)).toEqual([]);
    // Off the Library the list cannot tell, so age alone decides.
    expect(pruneDeleted(old, null, NOW)).toEqual(old);
  });

  it("ignores corrupt storage", () => {
    expect(parseDeleted(null)).toEqual([]);
    expect(parseDeleted("{not json")).toEqual([]);
    expect(parseDeleted('{"id":"a"}')).toEqual([]);
    expect(parseDeleted('[{"id":"a","at":5},{"id":3},null,"x"]')).toEqual([{ id: "a", at: 5 }]);
  });
});
