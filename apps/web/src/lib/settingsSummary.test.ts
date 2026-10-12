import { describe, expect, it } from "vitest";
import {
  dailySummary,
  modelSummary,
  sourcesSummary,
  topicsSummary,
  weeklyNote,
  weeklySummary,
  writerLabel,
} from "./settingsSummary";

describe("settings summaries", () => {
  it("word the podcast rows as the build and the saved overlay both show them", () => {
    expect(dailySummary({ hour: 9, cadenceDays: 2 })).toBe("Every second day at 09:00");
    // The zone is named only when it is not Stockholm's.
    expect(dailySummary({ hour: 9, cadenceDays: 2, timezone: "Europe/Stockholm" })).toBe(
      "Every second day at 09:00",
    );
    expect(weeklySummary({ enabled: true, day: 1, hour: 7, timezone: "Asia/Kolkata" })).toBe(
      "Mondays at 07:00 (India)",
    );
    expect(dailySummary({ hour: 7, cadenceDays: 5 })).toBe("Every 5 days at 07:00");
    expect(weeklySummary({ enabled: true, day: 1, hour: 7 })).toBe("Mondays at 07:00");
    expect(weeklySummary({ enabled: false, day: 1, hour: 7 })).toBe("Off");
  });

  it("say the weekly day on Daily only while the weekly podcast is on", () => {
    expect(weeklyNote({ enabled: true, day: 0 })).toBe(
      "On Sundays the weekly episode replaces this one.",
    );
    expect(weeklyNote({ enabled: false, day: 0 })).toBeNull();
  });

  it("name the model as the Model field does", () => {
    expect(writerLabel(null)).toBe("Default");
    expect(modelSummary("nebius", null)).toBe("Nebius, Default");
    expect(modelSummary("anthropic", "claude-haiku-5-5")).toBe("Anthropic, Claude Haiku 5.5");
  });

  it("count only the sources that are on", () => {
    expect(topicsSummary(9, 11)).toBe("9 topics · 11 sources");
    expect(topicsSummary(1, 1)).toBe("1 topic · 1 source");
    expect(sourcesSummary({ total: 3, on: 2 })).toBe("2 of 3 sources on");
    expect(sourcesSummary({ total: 0 })).toBe("No sources yet");
    expect(sourcesSummary({ total: 2, never: true })).toBe("Never in a briefing");
  });
});
