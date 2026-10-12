import { stockholmDate } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { sinceLabel } from "./format";
import { newBriefingLede } from "./newBriefing";

describe("newBriefingLede", () => {
  // 12 October 2026 is a Monday; noon in Stockholm.
  const now = new Date("2026-10-12T10:00:00Z");

  it("falls back to the last briefing on the same day or with no window", () => {
    expect(newBriefingLede("2026-10-12T05:00:00Z", now)).toBe(
      "Covers everything since the last briefing. Takes a few minutes.",
    );
    expect(newBriefingLede(undefined, now)).toBe(
      "Covers everything since the last briefing. Takes a few minutes.",
    );
  });

  it("says the same since as the build's sinceLabel", () => {
    for (const at of ["2026-10-11T21:30:00Z", "2026-10-06T05:00:00Z", "2026-10-01T05:00:00Z"]) {
      expect(newBriefingLede(at, now)).toBe(
        `Covers everything ${sinceLabel(at, stockholmDate(now))}. Takes a few minutes.`,
      );
    }
  });
});
