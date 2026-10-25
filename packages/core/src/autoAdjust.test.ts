import { describe, expect, it } from "vitest";
import {
  AUTO_ADJUST,
  adjustmentAt,
  applyVotes,
  effectiveWeight,
  emptyAutoAdjust,
} from "./autoAdjust.js";

const DAY = 86_400_000;
const T0 = "2026-10-01T00:00:00.000Z";
const vote = (story_id: string, value: "up" | "down" | "clear", at = T0) => ({
  story_id,
  topic: "design",
  source_id: "src-a",
  value,
  at,
});

describe("votes adjust a topic and a source, never the owner's weight", () => {
  it("moves a topic and its source by one step per new vote, bounded", () => {
    const one = applyVotes(emptyAutoAdjust(), [], [vote("s1", "up")]);
    expect(one.topics.design?.value).toBe(AUTO_ADJUST.step);
    expect(one.sources["src-a"]?.value).toBe(AUTO_ADJUST.step);

    const many = Array.from({ length: 40 }, (_, i) => vote(`d${i}`, "down"));
    const low = applyVotes(emptyAutoAdjust(), [], many);
    expect(low.topics.design?.value).toBe(-AUTO_ADJUST.max);
  });

  it("counts a repeat once, undoes a clear, and swings a changed vote by two steps", () => {
    const first = applyVotes(emptyAutoAdjust(), [], [vote("s1", "up")]);
    const same = applyVotes(first, [{ story_id: "s1", value: "up" }], [vote("s1", "up")]);
    expect(same).toEqual(first);
    const cleared = applyVotes(first, [{ story_id: "s1", value: "up" }], [vote("s1", "clear")]);
    expect(cleared.topics.design?.value).toBe(0);
    const flipped = applyVotes(first, [{ story_id: "s1", value: "up" }], [vote("s1", "down")]);
    expect(flipped.topics.design?.value).toBe(-AUTO_ADJUST.step);
  });

  it("decays toward zero by half each half-life and drops out below the shown floor", () => {
    const entry = { value: 0.2, at: T0 };
    const later = new Date(Date.parse(T0) + AUTO_ADJUST.half_life_days * DAY);
    expect(adjustmentAt(entry, later)).toBeCloseTo(0.1, 4);
    const far = new Date(Date.parse(T0) + 365 * DAY);
    expect(adjustmentAt(entry, far)).toBe(0);
  });

  it("adds to the owner's weight and keeps it on 0 to 1", () => {
    expect(effectiveWeight(0.5, 0.1)).toBeCloseTo(0.6);
    expect(effectiveWeight(0.95, 0.2)).toBe(1);
    expect(effectiveWeight(0.1, -0.2)).toBe(0);
  });
});
