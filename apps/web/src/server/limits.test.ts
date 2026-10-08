import { describe, expect, it } from "vitest";
import {
  COOLDOWN_MS,
  DAILY_CAP,
  DAY_MS,
  evaluateLimits,
  NARRATE_DAILY_CAP,
  PODCAST_COOLDOWN_MS,
  PODCAST_DAILY_CAP,
  PODCAST_POLICY,
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

describe("the narrate daily cap", () => {
  // How it is applied is tested with the document it is read from, in narrationState.test.ts.
  it("keeps the documented number", () => {
    expect(NARRATE_DAILY_CAP).toBe(3);
  });
});

describe("evaluateLimits for episodes", () => {
  const minutesAgo = (minutes: number) => NOW - minutes * 60 * 1000;

  it("keeps the documented numbers", () => {
    expect(PODCAST_COOLDOWN_MS).toBe(30 * 60 * 1000);
    expect(PODCAST_DAILY_CAP).toBe(2);
  });

  it("allows a first episode and one after the cooldown", () => {
    expect(evaluateLimits([], NOW, PODCAST_POLICY)).toEqual({ allowed: true });
    expect(evaluateLimits([minutesAgo(31)], NOW, PODCAST_POLICY)).toEqual({ allowed: true });
  });

  it("blocks within the cooldown and says how long is left", () => {
    expect(evaluateLimits([minutesAgo(10)], NOW, PODCAST_POLICY)).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: 20 * 60,
    });
  });

  it("blocks the third episode in a day until the oldest ages out", () => {
    expect(evaluateLimits([hoursAgo(2), hoursAgo(5)], NOW, PODCAST_POLICY)).toEqual({
      allowed: false,
      reason: "daily_cap",
      retryAfterSeconds: 19 * 3600,
    });
  });

  it("leaves the briefing numbers alone when no policy is given", () => {
    expect(evaluateLimits([minutesAgo(31)], NOW)).toMatchObject({
      allowed: false,
      reason: "cooldown",
    });
  });
});
