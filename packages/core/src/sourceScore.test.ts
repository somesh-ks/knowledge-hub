import { describe, expect, it } from "vitest";
import {
  combineScoreParts,
  FLAGGED_SHARE_LIMIT,
  MIN_JUDGED,
  MIN_SPARSE,
  SCORE_MAX,
  SCORE_THRESHOLDS,
  scoreLabel,
  scoreReasons,
  sourceScore,
  WEAK_PART,
} from "./index.js";

const now = new Date("2026-10-09T12:00:00Z");
const fresh = { failures: 0, last_ok: "2026-10-09T06:00:00Z" };
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
/** Productive and clean: a pass rate of 50 percent, a publish rate of 25 percent, none flagged. */
const clean = { fetched: 60, judged: 40, passed: 20, published: 10, asked: 40, flagged: 0 };
type Stat = typeof clean;
type Health = { failures: number; last_ok?: string };
const scoreOf = (stat: Partial<Stat>, health: Health = fresh) =>
  sourceScore({ stat: { ...clean, ...stat }, health, now });

describe("scoreLabel", () => {
  it("cuts at 4.5, 3.5 and 2.5 on a scale of 5", () => {
    expect(SCORE_THRESHOLDS).toEqual({ excellent: 4.5, good: 3.5, fair: 2.5 });
    expect(SCORE_MAX).toBe(5);
    expect(scoreLabel(5)).toBe("Excellent");
    expect(scoreLabel(4.5)).toBe("Excellent");
    expect(scoreLabel(4.4)).toBe("Good");
    expect(scoreLabel(3.5)).toBe("Good");
    expect(scoreLabel(3.4)).toBe("Fair");
    expect(scoreLabel(2.5)).toBe("Fair");
    expect(scoreLabel(2.4)).toBe("Poor");
    expect(scoreLabel(0)).toBe("Poor");
  });
});

describe("combineScoreParts", () => {
  it("is 5 times the geometric mean of the parts, rounded to one decimal", () => {
    expect(combineScoreParts([1, 1, 1])).toBe(5);
    expect(combineScoreParts([0.5, 0.5, 0.5])).toBe(2.5);
    expect(combineScoreParts([1, 1, 0.5])).toBe(4);
    expect(combineScoreParts([1, 0.5])).toBe(3.5);
  });

  it("is 0 when any part is 0, or when there are no parts", () => {
    expect(combineScoreParts([0, 1, 1])).toBe(0);
    expect(combineScoreParts([1, 0])).toBe(0);
    expect(combineScoreParts([])).toBe(0);
  });
});

describe("sourceScore: too little history", () => {
  it("is New with a null score and null parts below the judged minimum", () => {
    const result = scoreOf({ judged: MIN_JUDGED - 1, passed: 9, published: 5, asked: 9 });
    expect(result).toMatchObject({ score: null, parts: null, label: "New" });
    expect(result.reason).toContain("9 items judged");
  });

  it("is New at exactly zero history and names the discovery score", () => {
    const result = sourceScore({ quality: { score: 0.72 }, now });
    expect(result).toMatchObject({ score: null, parts: null, label: "New" });
    expect(result.reason).toBe(
      "Only 0 items judged so far; it scored 72 of 100 when it was found.",
    );
  });

  it("scores from the minimum judged count up", () => {
    const result = scoreOf({ judged: MIN_JUDGED, passed: 5, published: 3, asked: MIN_JUDGED });
    expect(result.score).not.toBeNull();
    expect(result.parts).not.toBeNull();
  });
});

describe("sourceScore: the scoring sample (D70)", () => {
  it("leaves sampled items out of the publish share and says how many there were", () => {
    expect(scoreOf({ judged: 60, passed: 30, asked: 60, sampled: 20 } as Partial<Stat>)).toEqual({
      score: 5,
      label: "Excellent",
      parts: { health: 1, quality: 1, trust: 1 },
      reason: "No weak part: 10 of 40 judged items published, 20 more sampled, no failures.",
    });
  });

  it("scores a source with nothing that could have been published on its pass share alone", () => {
    // A switched-off source, all sampled: no publish share or volume to hold it down.
    const stat = { judged: 12, passed: 6, published: 0, asked: 12, sampled: 12 };
    const result = scoreOf(stat as Partial<Stat>);
    expect(result.parts?.quality).toBe(1);
    expect(result.score).toBe(5);
    const weak = scoreOf({ ...stat, passed: 3 } as Partial<Stat>);
    expect(weak.parts?.quality).toBe(0.5);
    expect(weak.reason).toBe("Quality is the weakest part: 3 of 12 sampled items cleared the bar.");
  });

  it("moves smoothly when one item could have been published: no cliff at the first", () => {
    const stat = { judged: 13, passed: 6, published: 0, asked: 13, sampled: 12 };
    // Pass share 6 of 13 against a half: 0.92. One in thirteen weighs the pooled reading (0.56, nothing
    // published, the pass share filling in for the thin count), the rest the pass share alone: 0.9.
    expect(scoreOf(stat as Partial<Stat>).parts?.quality).toBe(0.9);
  });

  it(`scores a source whose feed held under ${MIN_JUDGED} posts on ${MIN_SPARSE} judged items`, () => {
    const sparse = { judged: 4, passed: 2, published: 0, asked: 4, sampled: 4 };
    const read = sourceScore({
      stat: { ...clean, ...sparse, feed_posts: 4, sampled_at: "2026-10-07" },
      health: fresh,
      now,
    });
    expect(read.label).not.toBe("New");
    expect(read.parts?.trust).toBeNull();
    expect(read.reason).toContain("it posts rarely, so this rests on 4 judged items");
    // Never read to fill it up (a weekly check, say), or a busy feed whose window halved: New.
    expect(sourceScore({ stat: { ...clean, ...sparse }, health: fresh, now }).label).toBe("New");
    const busy = { ...clean, ...sparse, judged: 7, feed_posts: 15, sampled_at: "2026-10-07" };
    expect(sourceScore({ stat: busy, health: fresh, now }).label).toBe("New");
    // A count from a read more than FEED_POSTS_FRESH_DAYS ago no longer stands.
    const stale = { ...clean, ...sparse, feed_posts: 4, sampled_at: "2026-08-01" };
    expect(sourceScore({ stat: stale, health: fresh, now }).label).toBe("New");
    // Fewer than MIN_SPARSE judged: New however rarely it posts.
    const two = {
      ...clean,
      ...sparse,
      judged: MIN_SPARSE - 1,
      feed_posts: 2,
      sampled_at: "2026-10-07",
    };
    expect(sourceScore({ stat: two, health: fresh, now }).label).toBe("New");
  });
});

describe("sourceScore: a general news feed", () => {
  it("counts stories another outlet also carried where other sources count published ones", () => {
    const stat = { ...clean, published: 0, covered: 10 };
    expect(sourceScore({ stat, health: fresh, now, feedsGeneral: true })).toEqual({
      score: 5,
      label: "Excellent",
      parts: { health: 1, quality: 1, trust: 1 },
      reason: "No weak part: 10 of 40 judged stories also carried by another outlet, no failures.",
    });
    // The same counters on a briefing source: nothing published, so quality is the pass share only.
    expect(sourceScore({ stat, health: fresh, now }).parts?.quality).toBe(0.4);
  });
});

describe("sourceScore: the three parts", () => {
  it("rates a productive, reliable, clean source 5 of 5, Excellent, with no weak part", () => {
    expect(scoreOf({})).toEqual({
      score: 5,
      label: "Excellent",
      parts: { health: 1, quality: 1, trust: 1 },
      reason: "No weak part: 10 of 40 judged items published, no failures.",
    });
  });

  it("reads health from failures in a row (60 percent) and the last good fetch (40 percent)", () => {
    const health = (failures: number, last_ok?: string) =>
      scoreOf({}, last_ok === undefined ? { failures } : { failures, last_ok }).parts?.health;
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

  it("reads quality from the pass share and the publish share, volume only weighting the second", () => {
    const quality = (stat: Partial<Stat>) => scoreOf(stat).parts?.quality;
    expect(quality({})).toBe(1);
    // A pass rate of 30 percent and a publish rate of 7.5 percent: 0.4 * 0.6 + 0.6 * 0.3.
    expect(quality({ passed: 12, published: 3 })).toBe(0.42);
    // A thin source leans on its pass share where it has too little to judge its publishing by.
    expect(quality({ judged: 10, passed: 5, published: 1, asked: 10 })).toBe(0.82);
    expect(quality({ judged: 100, passed: 50, published: 10, asked: 100 })).toBe(0.64);
  });

  it("scores a careful source that rarely publishes at least Good, not on how little it sends", () => {
    // 20 judged, every one passed, 1 published in the window: it was Fair (3.4) on the volume term.
    const careful = scoreOf({ judged: 20, passed: 20, published: 1, asked: 0 });
    expect(careful.score).toBeGreaterThanOrEqual(SCORE_THRESHOLDS.good);
    expect(careful.label).not.toBe("Fair");
  });

  it("reads trust as the share of asked items flagged as hype or sponsored, against a half", () => {
    const trust = (flagged: number) => scoreOf({ flagged }).parts?.trust;
    expect(FLAGGED_SHARE_LIMIT).toBe(0.5);
    expect(trust(0)).toBe(1);
    expect(trust(5)).toBe(0.75);
    expect(trust(10)).toBe(0.5);
    expect(trust(20)).toBe(0);
    expect(trust(30)).toBe(0);
    // Out of the items asked, not of every item judged: topic-only items are not asked.
    expect(scoreOf({ judged: 60, asked: 20, flagged: 5 }).parts?.trust).toBe(0.5);
  });
});

describe("sourceScore: the geometric mean", () => {
  it("rates a healthy source with nothing flagged and nothing published Poor", () => {
    const result = scoreOf({ passed: 0, published: 0 });
    expect(result).toMatchObject({
      score: 0,
      label: "Poor",
      parts: { health: 1, quality: 0, trust: 1 },
      reason: "Quality is the weakest part: 0 of 40 judged items published.",
    });
  });

  it("keeps a healthy, clean source with 1 of 40 published below Good", () => {
    const result = scoreOf({ passed: 5, published: 1 });
    expect(result.parts).toEqual({ health: 1, quality: 0.16, trust: 1 });
    expect(result).toMatchObject({ score: 2.7, label: "Fair" });
  });

  it("lets a weak part pull the score down more than a strong one lifts it", () => {
    // Parts that add up to the same 2.4: an even source beats one with a weak part.
    const even = scoreOf(
      { judged: 36, passed: 18, published: 5, asked: 30, flagged: 3 },
      { failures: 0, last_ok: daysAgo(10) },
    );
    const lopsided = scoreOf({ flagged: 12 });
    expect(even.parts).toEqual({ health: 0.8, quality: 0.73, trust: 0.8 });
    expect(lopsided.parts).toEqual({ health: 1, quality: 1, trust: 0.4 });
    expect(even.score).toBe(3.9);
    expect(lopsided.score).toBe(3.7);
  });

  it("gives 0 for a part of 0, whichever it is", () => {
    expect(scoreOf({ passed: 0, published: 0 }).score).toBe(0);
    expect(scoreOf({ flagged: 20 }).score).toBe(0);
  });

  it("combines the rounded parts and rounds the score to one decimal, within 0 to 5", () => {
    const result = scoreOf(
      { fetched: 41, judged: 17, passed: 7, published: 3, asked: 17, flagged: 2 },
      { failures: 1, last_ok: daysAgo(9) },
    );
    const parts = result.parts;
    if (!parts || parts.trust === null || result.score === null) {
      throw new Error("expected a measured score");
    }
    for (const part of [parts.health, parts.quality, parts.trust]) {
      expect(Number(part.toFixed(2))).toBe(part);
      expect(part).toBeGreaterThanOrEqual(0);
      expect(part).toBeLessThanOrEqual(1);
    }
    expect(result.score).toBe(
      Math.round(5 * Math.cbrt(parts.health * parts.quality * parts.trust) * 10) / 10,
    );
    expect(result.score).toBeLessThanOrEqual(SCORE_MAX);
  });

  it("labels on the 5-point scale", () => {
    expect(scoreOf({}).label).toBe("Excellent");
    expect(scoreOf({ flagged: 5 })).toMatchObject({ score: 4.5, label: "Excellent" });
    expect(scoreOf({ flagged: 10 })).toMatchObject({ score: 4, label: "Good" });
    expect(scoreOf({}, { failures: 9, last_ok: daysAgo(90) })).toMatchObject({
      score: 2.2,
      label: "Poor",
    });
  });
});

describe("sourceScore: trust not measured", () => {
  const legacy = { fetched: 60, judged: 40, passed: 20, published: 10 };

  it("leaves trust null for a record without asked, and scores the two measured parts", () => {
    const result = sourceScore({ stat: legacy, health: fresh, now });
    expect(result).toEqual({
      score: 5,
      label: "Excellent",
      parts: { health: 1, quality: 1, trust: null },
      reason: "Trust is not measured yet; 10 of 40 judged items published, no failures.",
    });
    // A flagged count without asked is not a measurement either.
    expect(sourceScore({ stat: { ...legacy, flagged: 30 }, health: fresh, now }).parts?.trust).toBe(
      null,
    );
  });

  it(`measures trust only from ${MIN_JUDGED} asked items up`, () => {
    expect(scoreOf({ asked: MIN_JUDGED - 1, flagged: 9 }).parts?.trust).toBeNull();
    expect(scoreOf({ asked: MIN_JUDGED - 1, flagged: 9 }).score).toBe(5);
    expect(scoreOf({ asked: MIN_JUDGED, flagged: 1 }).parts?.trust).toBe(0.8);
  });

  it("takes nothing from the discovery score", () => {
    const low = sourceScore({ stat: legacy, health: fresh, quality: { score: 0.1 }, now });
    const high = sourceScore({ stat: legacy, health: fresh, quality: { score: 1 }, now });
    expect(low).toEqual(high);
  });

  it("scores the square root of health times quality, and names a weak measured part", () => {
    const weak = sourceScore({ stat: { ...legacy, published: 0 }, health: fresh, now });
    expect(weak.parts).toEqual({ health: 1, quality: 0.4, trust: null });
    expect(weak).toMatchObject({ score: 3.2, label: "Fair" });
    expect(weak.reason).toBe(
      "Quality is the weakest part: 0 of 40 judged items published; trust is not measured yet.",
    );
  });
});

describe("sourceScore: the reason", () => {
  it("names the weakest part and what holds it down", () => {
    expect(scoreOf({}, { failures: 3, last_ok: fresh.last_ok }).reason).toBe(
      "Health is the weakest part: 3 failed fetches in a row.",
    );
    expect(scoreOf({}, { failures: 1, last_ok: fresh.last_ok }).reason).toBe(
      "Health is the weakest part: 1 failed fetch in a row.",
    );
    expect(scoreOf({}, { failures: 0, last_ok: daysAgo(40) }).reason).toBe(
      "Health is the weakest part: no fetch has worked for over two weeks.",
    );
    expect(scoreOf({}, { failures: 0, last_ok: daysAgo(10) }).reason).toBe(
      "Health is the weakest part: no fetch has worked for over a week.",
    );
    expect(scoreOf({ passed: 2, published: 0 }).reason).toBe(
      "Quality is the weakest part: 0 of 40 judged items published.",
    );
    expect(scoreOf({ flagged: 10 }).reason).toBe(
      "Trust is the weakest part: 10 of 40 checked items flagged as hype or sponsored.",
    );
  });

  it("picks the lowest part, the earlier one on a tie", () => {
    const lowest = scoreOf({ passed: 2, published: 0, flagged: 5 }, { ...fresh, failures: 3 });
    expect(lowest.parts).toEqual({ health: 0.55, quality: 0.04, trust: 0.75 });
    expect(lowest.reason).toMatch(/^Quality is the weakest part/);
    const tie = scoreOf({ flagged: 9 }, { failures: 3, last_ok: fresh.last_ok });
    expect(tie.parts).toMatchObject({ health: 0.55, trust: 0.55 });
    expect(tie.reason).toMatch(/^Health is the weakest part/);
  });

  it(`names no part when none is below ${WEAK_PART}`, () => {
    const result = scoreOf({}, { failures: 0, last_ok: daysAgo(5) });
    expect(result.parts).toEqual({ health: 0.92, quality: 1, trust: 1 });
    expect(result.score).toBe(4.9);
    expect(result.reason).toBe("No weak part: 10 of 40 judged items published, no failures.");
  });
});

describe("scoreReasons", () => {
  it("words the pass rate, then the hype share, for a source that fits few categories and is often flagged", () => {
    const counters = { judged: 57, passed: 9, published: 0, asked: 51, flagged: 22, failures: 0 };
    const rated = scoreOf({ ...counters, fetched: 84 });
    expect(scoreReasons(rated.parts, counters)).toEqual([
      "Most of its posts don't match your categories: 9 of 57 passed.",
      "4 in 10 of its posts were flagged as hype or sponsored.",
    ]);
    expect(scoreReasons(scoreOf({}).parts, { ...counters, failures: 0 })).toEqual([]);
  });
});
