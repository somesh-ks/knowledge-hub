import { describe, expect, it } from "vitest";
import { dailySummary, weeklySummary } from "./schedule";

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
