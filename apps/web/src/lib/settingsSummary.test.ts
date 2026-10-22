import { describe, expect, it } from "vitest";
import { dailySummary, sourcesSummary, weeklySummary } from "./settingsSummary";

describe("settings summaries", () => {
  it("word the podcast rows as the build and the saved overlay both show them", () => {
    expect(dailySummary({ hour: 9, cadenceDays: 2 })).toBe("Every other day at 9");
    // The zone is named only when it is not Stockholm's.
    expect(dailySummary({ hour: 9, cadenceDays: 2, timezone: "Europe/Stockholm" })).toBe(
      "Every other day at 9",
    );
    expect(weeklySummary({ day: 1, hour: 19, timezone: "Asia/Kolkata" })).toBe(
      "Mondays at 19 (India)",
    );
    expect(dailySummary({ hour: 7, cadenceDays: 5 })).toBe("Every 5 days at 7");
  });

  it("count only the sources that are on", () => {
    expect(sourcesSummary({ total: 11 })).toBe("11 sources");
    expect(sourcesSummary({ total: 3, on: 2 })).toBe("2 of 3 sources on");
    expect(sourcesSummary({ total: 0 })).toBe("No sources yet");
    expect(sourcesSummary({ total: 2, never: true })).toBe("Never in a briefing");
  });
});
