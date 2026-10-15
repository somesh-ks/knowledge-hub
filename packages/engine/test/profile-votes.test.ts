import { describe, expect, it } from "vitest";
import type { Vote } from "../src/profile/profile.js";
import { TasteFitter, tasteProfile } from "../src/profile/tasteFit.js";
import { VOTE_LIMITS, voteMultiplier, votePreferences } from "../src/profile/votes.js";
import { makeItem } from "./score-factories.js";
import { NO_WAIT } from "./write-fakes.js";

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

describe("taste check", () => {
  // A story the owner opened and then disliked once counted as liked in the taste the judge read,
  // and a Jev outage must never move a score.
  it("never counts a disliked story as liked, and keeps scores when Jev cannot answer", async () => {
    const down = votes(1, "down")[0] as Vote;
    const opens = [...votes(9, "up", 2), down].map(({ value: _value, ...open }) => open);
    const taste = tasteProfile({ votes: [down], opens });
    expect(taste?.disliked).toEqual([down.headline]);
    expect(taste?.liked).toHaveLength(9);
    expect(tasteProfile({ votes: [down], opens: opens.slice(0, 8) })).toBeNull();

    const failing = { systemOne: async () => Promise.reject(new Error("down")) };
    const fits = await new TasteFitter({ client: failing, retry: NO_WAIT }).fit(
      [makeItem({ title: "A story" })],
      taste as NonNullable<typeof taste>,
    );
    expect(fits.size).toBe(0);
  });
});
