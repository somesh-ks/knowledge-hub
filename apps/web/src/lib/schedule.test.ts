import { describe, expect, it } from "vitest";
import { dailySummary, hourLabel, nextBriefing, nextWeekly, weeklySummary } from "./schedule";

describe("hourLabel", () => {
  it("pads to two digits", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("the Settings rows", () => {
  it("say when the daily podcast runs", () => {
    expect(dailySummary({ hour: 7, cadenceDays: 2 })).toBe("Every second day at 07:00");
    expect(dailySummary({ hour: 18, cadenceDays: 1 })).toBe("Every day at 18:00");
    expect(dailySummary({ hour: 6, cadenceDays: 5 })).toBe("Every 5 days at 06:00");
  });

  it("say when the weekly podcast runs, or that it is off", () => {
    expect(weeklySummary({ enabled: true, day: 0, hour: 7 })).toBe("Sundays at 07:00");
    expect(weeklySummary({ enabled: false, day: 0, hour: 7 })).toBe("Off");
  });
});

describe("nextWeekly", () => {
  // 2026-10-08 is a Thursday. 09:00 UTC is 11:00 in Stockholm.
  const now = new Date("2026-10-08T09:00:00Z");

  it("names the day, today or tomorrow", () => {
    expect(nextWeekly({ now, day: 0, hour: 7 })).toBe("Next weekly: about Sunday at 07:00");
    expect(nextWeekly({ now, day: 4, hour: 18 })).toBe("Next weekly: about today at 18:00");
    expect(nextWeekly({ now, day: 5, hour: 7 })).toBe("Next weekly: about tomorrow at 07:00");
  });

  it("waits a week once the hour has passed", () => {
    expect(nextWeekly({ now, day: 4, hour: 7 })).toBe("Next weekly: about Thursday at 07:00");
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

  it("skips the weekly podcast's day and counts from the weekly podcast, as the gate does", () => {
    // Last briefing Thursday 8 October: Saturday is next, unless Saturday is the weekly day.
    const thursday = "2026-10-08T05:13:00Z";
    expect(
      nextBriefing({ now, hour: 7, cadenceDays: 2, lastRegularAt: thursday, weeklyDay: 6 }),
    ).toBe("Next briefing: about Sunday at 07:00");
    // Tuesday's briefing makes today due at 18:00, but Wednesday's weekly podcast moves it to tomorrow.
    const after = { now, hour: 18, cadenceDays: 2, lastRegularAt: "2026-10-06T05:13:00Z" };
    expect(nextBriefing(after)).toBe("Next briefing: about today at 18:00");
    expect(nextBriefing({ ...after, lastWeeklyAt: "2026-10-07T16:20:00Z", weeklyDay: 3 })).toBe(
      "Next briefing: about tomorrow at 18:00",
    );
  });
});
