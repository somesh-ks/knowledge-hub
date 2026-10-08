import { describe, expect, it } from "vitest";
import type { ManageTopic } from "./manage";
import { coverOptions, hourLabel, nextBriefing } from "./schedule";

const topic = (overrides: Partial<ManageTopic>): ManageTopic => ({
  id: "t",
  name: "Topic",
  description: "",
  weight: 0.5,
  step: 2,
  enabled: true,
  keywords: [],
  section_id: "ai",
  never_publish: false,
  origin: "builtin",
  ...overrides,
});

const sections = [
  { id: "top", title: "Top picks", order: 0 },
  { id: "ai", title: "AI Products", order: 1 },
  { id: "tech", title: "Tech Product Launches", order: 2 },
];

describe("hourLabel", () => {
  it("pads to two digits", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("coverOptions", () => {
  it("lists sections that have a live topic, without Top picks, with their topic names", () => {
    const options = coverOptions(
      [
        topic({ id: "a", name: "Frontier models", section_id: "ai" }),
        topic({ id: "b", name: "AI UX", section_id: "ai" }),
        topic({ id: "c", name: "Phones", section_id: "tech", enabled: false }),
      ],
      sections,
    );
    expect(options).toEqual([
      { id: "ai", title: "AI Products", topics: ["Frontier models", "AI UX"] },
    ]);
  });

  it("leaves out a topic that never publishes", () => {
    expect(coverOptions([topic({ never_publish: true, section_id: "top" })], sections)).toEqual([]);
  });
});

describe("nextBriefing", () => {
  const at = (iso: string) => new Date(iso);
  // 2026-10-08 is a Thursday. 09:00 UTC is 11:00 in Stockholm (CEST).
  const now = at("2026-10-08T09:00:00Z");

  it("counts from the last regular run by the cadence", () => {
    expect(
      nextBriefing({ now, hour: 7, cadenceDays: 2, lastRegularAt: "2026-10-08T05:13:00Z" }),
    ).toBe("Next briefing: about Saturday at 07:00");
    expect(
      nextBriefing({ now, hour: 7, cadenceDays: 1, lastRegularAt: "2026-10-08T05:13:00Z" }),
    ).toBe("Next briefing: about tomorrow at 07:00");
  });

  it("says today while the hour is still ahead, tomorrow once it has passed", () => {
    expect(nextBriefing({ now, hour: 18, cadenceDays: 1, lastRegularAt: null })).toBe(
      "Next briefing: about today at 18:00",
    );
    expect(nextBriefing({ now, hour: 7, cadenceDays: 1, lastRegularAt: null })).toBe(
      "Next briefing: about tomorrow at 07:00",
    );
  });

  it("does not look back when the last run is further away than the cadence", () => {
    expect(
      nextBriefing({ now, hour: 18, cadenceDays: 2, lastRegularAt: "2026-09-01T05:00:00Z" }),
    ).toBe("Next briefing: about today at 18:00");
  });

  it("ignores a last run it cannot read", () => {
    expect(nextBriefing({ now, hour: 18, cadenceDays: 2, lastRegularAt: "nope" })).toBe(
      "Next briefing: about today at 18:00",
    );
  });
});
