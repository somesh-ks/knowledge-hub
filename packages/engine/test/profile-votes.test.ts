import { describe, expect, it } from "vitest";
import type { Vote } from "../src/profile/profile.js";
import { VOTE_LIMITS, voteMultiplier, votePreferences } from "../src/profile/votes.js";

const NOW = new Date("2026-10-14T00:00:00Z");
const DAY = 86_400_000;

function votes(count: number, value: "up" | "down", daysAgo = 1, source = "s1"): Vote[] {
  return Array.from({ length: count }, (_, i) => ({
    story_id: `${source}-${value}-${daysAgo}-${i}`,
    url: `https://${source}.example/${i}`,
    headline: "h",
    domain: `${source}.example`,
    topic: "t",
    source_id: source,
    value,
    at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  }));
}

const multiplier = (list: Vote[]): number =>
  voteMultiplier(votePreferences(list, NOW), "s1", "https://s1.example/x");

describe("voteMultiplier", () => {
  it.each([
    ["no votes", [], 1],
    ["two downs: below the minimum", votes(2, "down"), 1],
    ["three ups and three downs cancel", [...votes(3, "up"), ...votes(3, "down")], 1],
  ])("%s -> %s", (_name, list, expected) => {
    expect(multiplier(list)).toBe(expected);
  });

  it("stays within the swing however many votes pile up", () => {
    const max = 1 + VOTE_LIMITS.max_swing;
    expect(multiplier(votes(200, "up"))).toBeLessThanOrEqual(max);
    expect(multiplier(votes(200, "down"))).toBeGreaterThanOrEqual(1 - VOTE_LIMITS.max_swing);
    expect(multiplier(votes(3, "down"))).toBeLessThan(1);
    expect(multiplier(votes(3, "up"))).toBeGreaterThan(1);
  });

  it("lets old votes fade", () => {
    expect(1 - multiplier(votes(5, "down", 120))).toBeLessThan(1 - multiplier(votes(5, "down", 1)));
  });
});
