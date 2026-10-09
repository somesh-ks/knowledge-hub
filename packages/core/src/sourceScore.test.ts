import { describe, expect, it } from "vitest";
import { MIN_JUDGED, scoreLabel, sourceScore } from "./index.js";

const now = new Date("2026-10-09T12:00:00Z");
const fresh = { failures: 0, last_ok: "2026-10-09T06:00:00Z" };

describe("scoreLabel", () => {
  it("cuts at 4.5, 3.5 and 2.5", () => {
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

describe("sourceScore", () => {
  it("is New with a null score below the judged minimum", () => {
    const stat = { fetched: 40, judged: MIN_JUDGED - 1, passed: 9, published: 5 };
    const result = sourceScore({ stat, health: fresh, now });
    expect(result.score).toBeNull();
    expect(result.label).toBe("New");
    expect(result.reason).toContain("9 items judged");
  });

  it("is New at exactly zero history and names the discovery score", () => {
    const result = sourceScore({ quality: { score: 0.72 }, now });
    expect(result).toMatchObject({ score: null, label: "New" });
    expect(result.reason).toContain("0 items judged");
    expect(result.reason).toContain("0.72");
  });

  it("scores from the minimum judged count up", () => {
    const stat = { fetched: 30, judged: MIN_JUDGED, passed: 5, published: 3 };
    expect(sourceScore({ stat, health: fresh, now }).score).not.toBeNull();
  });

  it("rates a productive, reliable source Excellent", () => {
    const stat = { fetched: 60, judged: 40, passed: 20, published: 10 };
    const result = sourceScore({ stat, health: fresh, quality: { score: 1 }, now });
    expect(result.score).toBe(5);
    expect(result.label).toBe("Excellent");
    expect(result.reason).toBe("10 of 40 judged items published, no failures.");
  });

  it("rates a source that never reaches a digest Poor", () => {
    const stat = { fetched: 80, judged: 50, passed: 2, published: 0 };
    const result = sourceScore({ stat, health: fresh, now });
    expect(result.label).toBe("Poor");
    expect(result.score).toBeLessThan(2.5);
  });

  it("weighs yield above reliability above volume", () => {
    const good = { fetched: 40, judged: 20, passed: 10, published: 5 };
    const lowYield = { fetched: 40, judged: 20, passed: 1, published: 0 };
    const base = sourceScore({ stat: good, health: fresh, now }).score ?? 0;
    const worseYield = sourceScore({ stat: lowYield, health: fresh, now }).score ?? 0;
    const worseHealth =
      sourceScore({ stat: good, health: { failures: 5, last_ok: fresh.last_ok }, now }).score ?? 0;
    expect(base - worseYield).toBeGreaterThan(base - worseHealth);
  });

  it("rates a thin but clean source below a busy one with the same rates", () => {
    const thin = { fetched: 12, judged: 10, passed: 5, published: 1 };
    const busy = { fetched: 120, judged: 100, passed: 50, published: 10 };
    expect(sourceScore({ stat: thin, health: fresh, now }).score ?? 9).toBeLessThan(
      sourceScore({ stat: busy, health: fresh, now }).score ?? 0,
    );
  });

  it("penalises failures and reports them", () => {
    const stat = { fetched: 40, judged: 20, passed: 10, published: 5 };
    const ok = sourceScore({ stat, health: fresh, now });
    const failing = sourceScore({ stat, health: { failures: 3, last_ok: fresh.last_ok }, now });
    expect(failing.score ?? 0).toBeLessThan(ok.score ?? 0);
    expect(failing.reason).toContain("3 failed fetches in a row");
  });

  it("penalises a stale last_ok and says so", () => {
    const stat = { fetched: 40, judged: 20, passed: 10, published: 5 };
    const stale = sourceScore({
      stat,
      health: { failures: 0, last_ok: "2026-09-01T00:00:00Z" },
      now,
    });
    const ok = sourceScore({ stat, health: fresh, now });
    expect(stale.score ?? 0).toBeLessThan(ok.score ?? 0);
    expect(stale.reason).toContain("over two weeks");
  });

  it("uses the discovery quality as a small prior", () => {
    const stat = { fetched: 40, judged: 20, passed: 6, published: 2 };
    const high = sourceScore({ stat, health: fresh, quality: { score: 1 }, now }).score ?? 0;
    const low = sourceScore({ stat, health: fresh, quality: { score: 0 }, now }).score ?? 0;
    expect(high - low).toBeGreaterThan(0);
    expect(high - low).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it("rounds to one decimal and stays within 0 to 5", () => {
    const stat = { fetched: 41, judged: 17, passed: 7, published: 3 };
    const { score } = sourceScore({ stat, health: fresh, quality: { score: 0.61 }, now });
    expect(score).not.toBeNull();
    expect(Number(score?.toFixed(1))).toBe(score);
    expect(score ?? -1).toBeGreaterThanOrEqual(0);
    expect(score ?? 6).toBeLessThanOrEqual(5);
  });
});
