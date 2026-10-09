import { describe, expect, it } from "vitest";
import { dailySummary, hourLabel, nextBriefing } from "./schedule";

describe("hourLabel", () => {
  it("pads to two digits", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("dailySummary", () => {
  it("reads as the time, the rhythm, the type and the length", () => {
    expect(dailySummary({ hour: 7, cadenceDays: 2, format: "readout", lengthMinutes: 10 })).toBe(
      "07:00, every second day, Readout, 10 min",
    );
    expect(
      dailySummary({ hour: 18, cadenceDays: 7, format: "headlines", lengthMinutes: 3 }),
    ).toBe("18:00, once a week, Headlines, 3 min");
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
