import { describe, expect, it } from "vitest";
import { activeSummary, dailySummary, sourcesSummary, weeklySummary } from "./settingsSummary";

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

  it("say how many of a topic's sources are active", () => {
    expect(activeSummary(3, 3)).toBe("3 sources active");
    expect(activeSummary(3, 2)).toBe("2 of 3 sources active");
    expect(activeSummary(1, 1)).toBe("1 source active");
  });

  it("count every source, on or off", () => {
    expect(sourcesSummary({ total: 11 })).toBe("11 sources");
    expect(sourcesSummary({ total: 0 })).toBe("No sources yet");
    expect(sourcesSummary({ total: 2, never: true })).toBe("Never in a podcast");
  });
});
