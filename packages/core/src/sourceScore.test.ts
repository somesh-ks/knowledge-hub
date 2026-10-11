import { describe, expect, it } from "vitest";
import {
  FLAGGED_SHARE_LIMIT,
  MIN_JUDGED,
  SCORE_MAX,
  SCORE_THRESHOLDS,
  scoreLabel,
  sourceScore,
  WEAK_PART,
} from "./index.js";

const now = new Date("2026-10-09T12:00:00Z");
const fresh = { failures: 0, last_ok: "2026-10-09T06:00:00Z" };
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
/** Productive and clean: a pass rate of 50 percent, a publish rate of 25 percent, none flagged. */
const clean = { fetched: 60, judged: 40, passed: 20, published: 10, flagged: 0 };

describe("scoreLabel", () => {
  it("cuts at 2.7, 2.1 and 1.5 on a scale of 3", () => {
    expect(SCORE_THRESHOLDS).toEqual({ excellent: 2.7, good: 2.1, fair: 1.5 });
    expect(SCORE_MAX).toBe(3);
    expect(scoreLabel(3)).toBe("Excellent");
    expect(scoreLabel(2.7)).toBe("Excellent");
    expect(scoreLabel(2.6)).toBe("Good");
    expect(scoreLabel(2.1)).toBe("Good");
    expect(scoreLabel(2)).toBe("Fair");
    expect(scoreLabel(1.5)).toBe("Fair");
    expect(scoreLabel(1.4)).toBe("Poor");
    expect(scoreLabel(0)).toBe("Poor");
  });
});

describe("sourceScore: too little history", () => {
  it("is New with a null score and null parts below the judged minimum", () => {
    const stat = { fetched: 40, judged: MIN_JUDGED - 1, passed: 9, published: 5, flagged: 0 };
    const result = sourceScore({ stat, health: fresh, now });
    expect(result).toMatchObject({ score: null, parts: null, label: "New" });
    expect(result.reason).toContain("9 items judged");
  });

  it("is New at exactly zero history and names the discovery score", () => {
    const result = sourceScore({ quality: { score: 0.72 }, now });
    expect(result).toMatchObject({ score: null, parts: null, label: "New" });
    expect(result.reason).toBe("Only 0 items judged so far; discovery scored it 0.72 of 1.");
  });

  it("scores from the minimum judged count up", () => {
    const stat = { fetched: 30, judged: MIN_JUDGED, passed: 5, published: 3, flagged: 0 };
    const result = sourceScore({ stat, health: fresh, now });
    expect(result.score).not.toBeNull();
    expect(result.parts).not.toBeNull();
  });
});

describe("sourceScore: the three parts", () => {
  it("rates a productive, reliable, clean source 3 of 3, Excellent, with no weak part", () => {
    const result = sourceScore({ stat: clean, health: fresh, now });
    expect(result).toEqual({
      score: 3,
      label: "Excellent",
      parts: { health: 1, quality: 1, trust: 1 },
      reason: "No weak part: 10 of 40 judged items published, no failures.",
    });
  });

  it("reads health from failures in a row (60 percent) and the last good fetch (40 percent)", () => {
    const health = (failures: number, last_ok?: string) =>
      sourceScore({ stat: clean, health: { failures, last_ok }, now }).parts?.health;
    expect(health(0, fresh.last_ok)).toBe(1);
    expect(health(1, fresh.last_ok)).toBe(0.82);
    expect(health(2, fresh.last_ok)).toBe(0.7);
    expect(health(3, fresh.last_ok)).toBe(0.55);
    expect(health(0, daysAgo(5))).toBe(0.92);
    expect(health(0, daysAgo(10))).toBe(0.8);
    expect(health(0, daysAgo(40))).toBe(0.68);
    expect(health(0)).toBe(0.84);
    expect(health(5, daysAgo(40))).toBe(0.08);
  });

  it("reads quality as three quarters yield and one quarter volume", () => {
    const quality = (stat: typeof clean) =>
      sourceScore({ stat, health: fresh, now }).parts?.quality;
    expect(quality(clean)).toBe(1);
    // A pass rate of 30 percent and a publish rate of 7.5 percent: yield 0.42, volume 0.75.
    expect(quality({ ...clean, passed: 12, published: 3 })).toBe(0.5);
    // A thin source with the same rates as a busy one loses only the volume share.
    const thin = quality({ fetched: 12, judged: 10, passed: 5, published: 1, flagged: 0 });
    const busy = quality({ fetched: 120, judged: 100, passed: 50, published: 10, flagged: 0 });
    expect(thin).toBe(0.54);
    expect(busy).toBe(0.73);
  });

  it("reads trust as the share flagged as hype or sponsored against a half", () => {
    const trust = (flagged: number) =>
      sourceScore({ stat: { ...clean, flagged }, health: fresh, now }).parts?.trust;
    expect(FLAGGED_SHARE_LIMIT).toBe(0.5);
    expect(trust(0)).toBe(1);
    expect(trust(5)).toBe(0.75);
    expect(trust(10)).toBe(0.5);
    expect(trust(20)).toBe(0);
    expect(trust(30)).toBe(0);
  });

  it("weighs the parts the same, so each moves the score by at most 1", () => {
    const sick = sourceScore({ stat: clean, health: { failures: 9, last_ok: daysAgo(90) }, now });
    const useless = sourceScore({
      stat: { fetched: 80, judged: 40, passed: 0, published: 0, flagged: 0 },
      health: fresh,
      now,
    });
    const hyped = sourceScore({ stat: { ...clean, flagged: 40 }, health: fresh, now });
    expect(sick.parts?.health).toBe(0.08);
    expect(useless.parts?.quality).toBe(0);
    expect(hyped.parts?.trust).toBe(0);
    expect(useless.score).toBe(2);
    expect(hyped.score).toBe(2);
    expect(sick.score).toBe(2.1);
  });

  it("adds the rounded parts and rounds the score to one decimal, within 0 to 3", () => {
    const stat = { fetched: 41, judged: 17, passed: 7, published: 3, flagged: 2 };
    const result = sourceScore({ stat, health: { failures: 1, last_ok: daysAgo(9) }, now });
    const parts = result.parts;
    expect(parts).not.toBeNull();
    if (!parts || result.score === null) return;
    for (const part of [parts.health, parts.quality, parts.trust]) {
      expect(Number(part.toFixed(2))).toBe(part);
      expect(part).toBeGreaterThanOrEqual(0);
      expect(part).toBeLessThanOrEqual(1);
    }
    expect(result.score).toBe(Math.round((parts.health + parts.quality + parts.trust) * 10) / 10);
    expect(Number(result.score.toFixed(1))).toBe(result.score);
    expect(result.score).toBeLessThanOrEqual(SCORE_MAX);
  });

  it("labels on the 3-point scale", () => {
    const label = (stat: typeof clean) => sourceScore({ stat, health: fresh, now }).label;
    expect(label(clean)).toBe("Excellent");
    expect(label({ ...clean, flagged: 10 })).toBe("Good");
    expect(label({ ...clean, flagged: 20 })).toBe("Fair");
    expect(
      sourceScore({
        stat: { ...clean, passed: 0, published: 0, flagged: 20 },
        health: fresh,
        now,
      }).label,
    ).toBe("Poor");
  });
});

describe("sourceScore: a record written before flags were counted", () => {
  const legacy = { fetched: 60, judged: 40, passed: 20, published: 10 };

  it("takes the discovery quality as trust, or the neutral half without one", () => {
    expect(
      sourceScore({ stat: legacy, health: fresh, quality: { score: 0.72 }, now }).parts?.trust,
    ).toBe(0.72);
    const neutral = sourceScore({ stat: legacy, health: fresh, now });
    expect(neutral.parts?.trust).toBe(0.5);
    expect(neutral.score).toBe(2.5);
  });

  it("says trust is not measured yet, and never names it as the weakest part", () => {
    const low = sourceScore({ stat: legacy, health: fresh, quality: { score: 0.1 }, now });
    expect(low.parts?.trust).toBe(0.1);
    expect(low.reason).toBe(
      "Trust is not measured yet; 10 of 40 judged items published, no failures.",
    );
    const weak = sourceScore({ stat: { ...legacy, published: 0 }, health: fresh, now });
    expect(weak.reason).toBe(
      "Quality is the weakest part: 0 of 40 judged items published; trust is not measured yet.",
    );
  });
});

describe("sourceScore: the reason", () => {
  it("names the weakest part and what holds it down", () => {
    expect(
      sourceScore({ stat: clean, health: { failures: 3, last_ok: fresh.last_ok }, now }).reason,
    ).toBe("Health is the weakest part: 3 failed fetches in a row.");
    expect(
      sourceScore({ stat: clean, health: { failures: 1, last_ok: fresh.last_ok }, now }).reason,
    ).toBe("Health is the weakest part: 1 failed fetch in a row.");
    expect(
      sourceScore({ stat: clean, health: { failures: 0, last_ok: daysAgo(40) }, now }).reason,
    ).toBe("Health is the weakest part: no fetch has worked for over two weeks.");
    expect(
      sourceScore({ stat: clean, health: { failures: 0, last_ok: daysAgo(10) }, now }).reason,
    ).toBe("Health is the weakest part: no fetch has worked for over a week.");
    expect(
      sourceScore({ stat: { ...clean, passed: 2, published: 0 }, health: fresh, now }).reason,
    ).toBe("Quality is the weakest part: 0 of 40 judged items published.");
    expect(sourceScore({ stat: { ...clean, flagged: 10 }, health: fresh, now }).reason).toBe(
      "Trust is the weakest part: 10 of 40 judged items flagged as hype or sponsored.",
    );
  });

  it("picks the lowest part, the earlier one on a tie", () => {
    const stat = { ...clean, passed: 2, published: 0, flagged: 5 };
    const result = sourceScore({ stat, health: { failures: 3, last_ok: fresh.last_ok }, now });
    expect(result.parts).toEqual({ health: 0.55, quality: 0.03, trust: 0.75 });
    expect(result.reason).toMatch(/^Quality is the weakest part/);
    const tie = sourceScore({
      stat: { ...clean, flagged: 9 },
      health: { failures: 3, last_ok: fresh.last_ok },
      now,
    });
    expect(tie.parts).toMatchObject({ health: 0.55, trust: 0.55 });
    expect(tie.reason).toMatch(/^Health is the weakest part/);
  });

  it(`names no part when none is below ${WEAK_PART}`, () => {
    const result = sourceScore({
      stat: clean,
      health: { failures: 0, last_ok: daysAgo(5) },
      now,
    });
    expect(result.parts).toEqual({ health: 0.92, quality: 1, trust: 1 });
    expect(result.score).toBe(2.9);
    expect(result.reason).toBe("No weak part: 10 of 40 judged items published, no failures.");
  });
});
