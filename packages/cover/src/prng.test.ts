import { describe, expect, it } from "vitest";
import { fbm, hash32, mulberry32, valueNoise } from "./prng.js";

describe("mulberry32", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 50; i += 1) expect(a.next()).toBe(b.next());
  });

  it("produces different streams for different seeds", () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it("stays in [0, 1) and spreads across the range", () => {
    const rng = mulberry32(99);
    const values = Array.from({ length: 2000 }, () => rng.next());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("matches the reference mulberry32 output for seed 1", () => {
    // First value of the canonical mulberry32 implementation with seed 1.
    expect(mulberry32(1).next()).toBeCloseTo(0.6270739405881613, 12);
  });

  it("supports bounded helpers", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const r = rng.range(3, 5);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThan(5);
      const k = rng.int(2, 4);
      expect([2, 3, 4]).toContain(k);
    }
    expect(rng.pick(["a"])).toBe("a");
    expect(() => rng.pick([])).toThrow();
  });

  it("weights choices", () => {
    const rng = mulberry32(3);
    let heavy = 0;
    for (let i = 0; i < 2000; i += 1) {
      if (rng.weighted(["a", "b"], (x) => (x === "a" ? 9 : 1)) === "a") heavy += 1;
    }
    expect(heavy / 2000).toBeGreaterThan(0.85);
  });
});

describe("hash32", () => {
  it("is stable and unsigned", () => {
    expect(hash32("2026-10-06")).toBe(hash32("2026-10-06"));
    expect(hash32("2026-10-06")).toBeGreaterThanOrEqual(0);
    expect(hash32("2026-10-06")).toBeLessThanOrEqual(0xffffffff);
  });

  it("separates neighbors", () => {
    expect(hash32("2026-10-06")).not.toBe(hash32("2026-10-07"));
  });
});

describe("noise", () => {
  it("returns values in [0, 1] and is deterministic", () => {
    for (let i = 0; i < 200; i += 1) {
      const v = valueNoise(i * 0.37, i * 0.11, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm(i * 0.2, i * 0.3, 9, 4)).toBe(fbm(i * 0.2, i * 0.3, 9, 4));
    }
  });

  it("is continuous", () => {
    expect(Math.abs(valueNoise(3.2, 4.1, 1) - valueNoise(3.2001, 4.1001, 1))).toBeLessThan(0.01);
  });
});
