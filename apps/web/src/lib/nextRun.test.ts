import { describe, expect, it } from "vitest";
import { hourLabel, nextBriefing, nextRunLine, nextWeekly } from "./nextRun";

describe("hourLabel", () => {
  it("pads to two digits", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("nextWeekly", () => {
  // 2026-10-08 is a Thursday. 09:00 UTC is 11:00 in Stockholm.
  const now = new Date("2026-10-08T09:00:00Z");

  it("names the day, today or tomorrow", () => {
    expect(nextWeekly({ now, day: 0, hour: 7 })).toBe("Next episode: about Sunday at 07:00");
    expect(nextWeekly({ now, day: 4, hour: 18 })).toBe("Next episode: about today at 18:00");
    expect(nextWeekly({ now, day: 5, hour: 7 })).toBe("Next episode: about tomorrow at 07:00");
  });

  it("waits a week once the hour has passed", () => {
    expect(nextWeekly({ now, day: 4, hour: 7 })).toBe("Next episode: about Thursday at 07:00");
  });
});

describe("nextBriefing", () => {
  const at = (iso: string) => new Date(iso);
  // 2026-10-08 is a Thursday. 09:00 UTC is 11:00 in Stockholm (CEST).
  const now = at("2026-10-08T09:00:00Z");

  it("counts from the last regular run by the cadence", () => {
    expect(
      nextBriefing({ now, hour: 7, cadenceDays: 2, lastRegularAt: "2026-10-08T05:13:00Z" }),
    ).toBe("Next episode: about Saturday at 07:00");
    expect(
      nextBriefing({ now, hour: 7, cadenceDays: 1, lastRegularAt: "2026-10-08T05:13:00Z" }),
    ).toBe("Next episode: about tomorrow at 07:00");
  });

  it("says today while the hour is still ahead, tomorrow once it has passed", () => {
    expect(nextBriefing({ now, hour: 18, cadenceDays: 1, lastRegularAt: null })).toBe(
      "Next episode: about today at 18:00",
    );
    expect(nextBriefing({ now, hour: 7, cadenceDays: 1, lastRegularAt: null })).toBe(
      "Next episode: about tomorrow at 07:00",
    );
  });

  it("does not look back when the last run is further away than the cadence", () => {
    expect(
      nextBriefing({ now, hour: 18, cadenceDays: 2, lastRegularAt: "2026-09-01T05:00:00Z" }),
    ).toBe("Next episode: about today at 18:00");
  });

  it("ignores a last run it cannot read", () => {
    expect(nextBriefing({ now, hour: 18, cadenceDays: 2, lastRegularAt: "nope" })).toBe(
      "Next episode: about today at 18:00",
    );
  });

  it("skips the weekly podcast's day and counts from the weekly podcast, as the gate does", () => {
    // Last briefing Thursday 8 October: Saturday is next, unless Saturday is the weekly day.
    const thursday = "2026-10-08T05:13:00Z";
    expect(
      nextBriefing({ now, hour: 7, cadenceDays: 2, lastRegularAt: thursday, weeklyDay: 6 }),
    ).toBe("Next episode: about Sunday at 07:00");
    // Tuesday's briefing makes today due at 18:00, but Wednesday's weekly podcast moves it to tomorrow.
    const after = { now, hour: 18, cadenceDays: 2, lastRegularAt: "2026-10-06T05:13:00Z" };
    expect(nextBriefing(after)).toBe("Next episode: about today at 18:00");
    expect(nextBriefing({ ...after, lastWeeklyAt: "2026-10-07T16:20:00Z", weeklyDay: 3 })).toBe(
      "Next episode: about tomorrow at 18:00",
    );
  });
});

describe("nextRunLine", () => {
  // 2026-10-08 is a Thursday. 09:00 UTC is 11:00 in Stockholm.
  const now = new Date("2026-10-08T09:00:00Z");
  const anchors = { lastRegularAt: "2026-10-08T05:13:00Z", lastWeeklyAt: null, weeklyDay: null };

  it("follows the fields on screen, not the ones the page was built with", () => {
    const daily = { "daily.hour": "7", "daily.cadence": "2" };
    expect(nextRunLine("daily", daily, anchors, now)).toBe("Next episode: about Saturday at 07:00");
    expect(nextRunLine("daily", { ...daily, "daily.cadence": "1" }, anchors, now)).toBe(
      "Next episode: about tomorrow at 07:00",
    );
    expect(nextRunLine("daily", { ...daily, "daily.hour": "9" }, anchors, now)).toBe(
      "Next episode: about Saturday at 09:00",
    );
    expect(nextRunLine("weekly", { "weekly.day": "1", "weekly.hour": "7" }, anchors, now)).toBe(
      "Next episode: about Monday at 07:00",
    );
  });

  it("goes by the time it is now, so a page built days ago does not say today", () => {
    const later = new Date("2026-10-10T09:00:00Z");
    const daily = { "daily.hour": "18", "daily.cadence": "2" };
    expect(nextRunLine("daily", daily, anchors, now)).toBe("Next episode: about Saturday at 18:00");
    expect(nextRunLine("daily", daily, anchors, later)).toBe("Next episode: about today at 18:00");
  });

  it("is null when the fields are missing", () => {
    expect(nextRunLine("daily", { "daily.hour": "7" }, anchors, now)).toBeNull();
    expect(nextRunLine("weekly", {}, anchors, now)).toBeNull();
  });
});
