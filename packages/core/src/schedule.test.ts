import { describe, expect, it } from "vitest";
import {
  ConfigOp,
  DEFAULT_SCHEDULE,
  ScheduleFile,
  ScheduleSettings,
  scheduleCovers,
  scheduleCron,
} from "./index.js";

describe("ScheduleFile", () => {
  it("accepts the defaults and a chosen list of sections", () => {
    expect(ScheduleFile.parse(DEFAULT_SCHEDULE)).toEqual(DEFAULT_SCHEDULE);
    expect(
      ScheduleFile.safeParse({ version: 1, hour: 23, cadence_days: 7, sections: ["ai", "tech"] })
        .success,
    ).toBe(true);
  });

  it("rejects an hour outside 0 to 23 and a cadence outside 1, 2, 3 and 7", () => {
    for (const hour of [-1, 24, 7.5]) {
      expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, hour }).success, `hour ${hour}`).toBe(
        false,
      );
    }
    for (const cadence_days of [0, 4, 5, 6, 14]) {
      expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, cadence_days }).success).toBe(false);
    }
  });

  it("keeps the schedule.set settings free of a version", () => {
    expect(ScheduleSettings.safeParse({ hour: 9, cadence_days: 1, sections: null }).success).toBe(
      true,
    );
  });

  it("fills a readout of 10 minutes into a file written before format and length existed", () => {
    const old = { version: 1, hour: 9, cadence_days: 3, sections: null };
    expect(ScheduleFile.parse(old)).toEqual({ ...old, format: "readout", length_minutes: 10 });
  });

  it("accepts every format and length and refuses others", () => {
    for (const format of ["readout", "discussion", "headlines"]) {
      expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, format }).success).toBe(true);
    }
    for (const length_minutes of [3, 5, 10, 15]) {
      expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, length_minutes }).success).toBe(true);
    }
    expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, format: "song" }).success).toBe(false);
    expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, length_minutes: 7 }).success).toBe(false);
  });

  it("lets the schedule.set op leave format and length out", () => {
    const set = { op: "schedule.set", hour: 9, cadence_days: 1, sections: null };
    expect(ConfigOp.safeParse(set).success).toBe(true);
    expect(ConfigOp.safeParse({ ...set, format: "headlines", length_minutes: 5 }).success).toBe(
      true,
    );
    expect(ConfigOp.safeParse({ ...set, length_minutes: 4 }).success).toBe(false);
  });
});

describe("scheduleCovers", () => {
  it("covers everything when sections is null", () => {
    expect(scheduleCovers({ sections: null }, "ai")).toBe(true);
  });

  it("covers only the listed sections and always Top picks", () => {
    const schedule = { sections: ["ai"] };
    expect(scheduleCovers(schedule, "ai")).toBe(true);
    expect(scheduleCovers(schedule, "top")).toBe(true);
    expect(scheduleCovers(schedule, "tech")).toBe(false);
  });
});

describe("scheduleCron", () => {
  it("is the cron the workflow compares against", () => {
    expect(scheduleCron(7)).toBe("13 7 * * *");
    expect(scheduleCron(23)).toBe("13 23 * * *");
  });
});

describe("schedule.set op", () => {
  it("parses and refuses an hour or cadence out of range", () => {
    const ok = { op: "schedule.set", hour: 9, cadence_days: 3, sections: ["ai"] };
    expect(ConfigOp.safeParse(ok).success).toBe(true);
    expect(ConfigOp.safeParse({ ...ok, hour: 24 }).success).toBe(false);
    expect(ConfigOp.safeParse({ ...ok, cadence_days: 4 }).success).toBe(false);
    expect(ConfigOp.safeParse({ ...ok, sections: undefined }).success).toBe(false);
  });
});
