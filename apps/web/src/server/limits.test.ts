import { describe, expect, it } from "vitest";
import {
  COOLDOWN_MS,
  DAILY_CAP,
  DAY_MS,
  evaluateDailyCap,
  evaluateLimits,
  NARRATE_DAILY_CAP,
} from "./limits";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const hoursAgo = (hours: number) => NOW - hours * 60 * 60 * 1000;

describe("evaluateLimits", () => {
  it("allows a first run", () => {
    expect(evaluateLimits([], NOW)).toEqual({ allowed: true });
  });

  it("allows a run when the last one is older than the cooldown", () => {
    expect(evaluateLimits([hoursAgo(6.01)], NOW)).toEqual({ allowed: true });
    expect(evaluateLimits([hoursAgo(7)], NOW)).toEqual({ allowed: true });
  });

  it("blocks within the 6 hour cooldown and says how long is left", () => {
    expect(evaluateLimits([hoursAgo(1)], NOW)).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: 5 * 60 * 60,
    });
  });

  it("rounds the wait up to whole seconds", () => {
    const start = NOW - COOLDOWN_MS + 1500;
    expect(evaluateLimits([start], NOW)).toMatchObject({ retryAfterSeconds: 2 });
  });

  it("allows two runs in a day and blocks the third", () => {
    expect(evaluateLimits([hoursAgo(7), hoursAgo(14)], NOW)).toEqual({ allowed: true });
    const blocked = evaluateLimits([hoursAgo(7), hoursAgo(14), hoursAgo(21)], NOW);
    expect(blocked).toMatchObject({ allowed: false, reason: "daily_cap" });
  });

  it("waits for the oldest run to leave the day window", () => {
    const decision = evaluateLimits([hoursAgo(7), hoursAgo(14), hoursAgo(21)], NOW);
    // The oldest run is 21 hours old, so it ages out in 3 hours.
    expect(decision).toEqual({
      allowed: false,
      reason: "daily_cap",
      retryAfterSeconds: 3 * 60 * 60,
    });
  });

  it("names the longer wait when both limits apply", () => {
    // The newest run is 1 hour old (5 hours of cooldown left); the oldest ages out in 3 hours.
    const decision = evaluateLimits([hoursAgo(1), hoursAgo(10), hoursAgo(21)], NOW);
    expect(decision).toMatchObject({
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: 5 * 3600,
    });
  });

  it("names the daily cap when it outlasts the cooldown", () => {
    const decision = evaluateLimits([hoursAgo(5), hoursAgo(10), hoursAgo(11)], NOW);
    // 1 hour of cooldown left, but the oldest run leaves the window in 13 hours.
    expect(decision).toEqual({ allowed: false, reason: "daily_cap", retryAfterSeconds: 13 * 3600 });
  });

  it("ignores runs older than a day", () => {
    expect(evaluateLimits([hoursAgo(25), hoursAgo(30), hoursAgo(48), hoursAgo(72)], NOW)).toEqual({
      allowed: true,
    });
  });

  it("does not depend on the order runs are listed in", () => {
    const runs = [hoursAgo(21), hoursAgo(7), hoursAgo(14)];
    expect(evaluateLimits(runs, NOW)).toEqual(evaluateLimits([...runs].reverse(), NOW));
  });

  it("keeps the documented numbers", () => {
    expect(COOLDOWN_MS).toBe(6 * 3600 * 1000);
    expect(DAY_MS).toBe(24 * 3600 * 1000);
    expect(DAILY_CAP).toBe(3);
  });
});

describe("evaluateDailyCap", () => {
  it("allows narrations up to the cap, with no cooldown between them", () => {
    expect(evaluateDailyCap([], NOW)).toEqual({ allowed: true });
    expect(evaluateDailyCap([hoursAgo(0.01), hoursAgo(0.02)], NOW)).toEqual({ allowed: true });
  });

  it("blocks at the cap and waits for the oldest upload to leave the day window", () => {
    expect(evaluateDailyCap([hoursAgo(1), hoursAgo(5), hoursAgo(20)], NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: 4 * 3600,
    });
  });

  it("waits for as many uploads to age out as it takes to get under the cap", () => {
    // Five in the window: the third oldest has to leave before one more fits.
    const uploads = [hoursAgo(1), hoursAgo(2), hoursAgo(10), hoursAgo(15), hoursAgo(20)];
    expect(evaluateDailyCap(uploads, NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: 14 * 3600,
    });
  });

  it("ignores uploads older than a day and the order they are listed in", () => {
    expect(evaluateDailyCap([hoursAgo(25), hoursAgo(30), hoursAgo(48)], NOW)).toEqual({
      allowed: true,
    });
    const uploads = [hoursAgo(20), hoursAgo(1), hoursAgo(5)];
    expect(evaluateDailyCap(uploads, NOW)).toEqual(evaluateDailyCap([...uploads].reverse(), NOW));
  });

  it("rounds the wait up to whole seconds and takes another cap", () => {
    expect(evaluateDailyCap([NOW - DAY_MS + 1500], NOW, 1)).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
    });
    expect(evaluateDailyCap([hoursAgo(1)], NOW, 2)).toEqual({ allowed: true });
  });

  it("keeps the documented number", () => {
    expect(NARRATE_DAILY_CAP).toBe(3);
  });
});
