import { describe, expect, it } from "vitest";
import {
  ConfigOp,
  DEFAULT_SCHEDULE,
  effectiveSkipTopics,
  podcastVoices,
  ScheduleChange,
  ScheduleFile,
  withGeneralScope,
} from "./index.js";

describe("podcastVoices", () => {
  // The bug: Weekly and Catch up kept reading their own old voices after the owner chose one pair
  // for every podcast, so the site and the engine named stored audio for different voices.
  it("gives weekly and Create episodes the shared pair, their own voices only while it is unset", () => {
    const old = ScheduleFile.parse({
      ...DEFAULT_SCHEDULE,
      weekly: { voice_id: "old_w", voice_id_b: "old_wb" },
      custom: { voice_id: "old_c" },
    });
    expect(podcastVoices(old, "weekly")).toEqual({ voice_id: "old_w", voice_id_b: "old_wb" });
    const shared = { ...old, voice_id: "ada_1", voice_id_b: "leo_2" };
    for (const profile of ["daily", "weekly", "custom"] as const) {
      expect(podcastVoices(shared, profile)).toEqual({ voice_id: "ada_1", voice_id_b: "leo_2" });
    }
  });
});

describe("ScheduleFile", () => {
  it("accepts the defaults and a list of topics left out", () => {
    expect(ScheduleFile.parse(DEFAULT_SCHEDULE)).toEqual(DEFAULT_SCHEDULE);
    const parsed = ScheduleFile.parse({
      version: 1,
      hour: 23,
      cadence_days: 7,
      skip_topics: ["trending"],
      weekly: { skip_topics: ["design"] },
    });
    expect(parsed.skip_topics).toEqual(["trending"]);
    expect(parsed.weekly.skip_topics).toEqual(["design"]);
  });

  it("reads a file from before topics could be left out as leaving none out", () => {
    const parsed = ScheduleFile.parse({ version: 1, hour: 7, cadence_days: 2, sections: null });
    expect(parsed.skip_topics).toEqual([]);
    expect(parsed.weekly.skip_topics).toEqual([]);
    expect("sections" in parsed).toBe(false);
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

  it("keeps the schedule.set change free of a version and every field optional", () => {
    expect(ScheduleChange.safeParse({ hour: 9, cadence_days: 1, skip_topics: [] }).success).toBe(
      true,
    );
    expect(ScheduleChange.safeParse({}).success).toBe(true);
  });

  it("fills a readout of 10 minutes into a file written before format and length existed", () => {
    const old = { version: 1, hour: 9, cadence_days: 3 };
    expect(ScheduleFile.parse(old)).toMatchObject({
      ...old,
      format: "readout",
      length_minutes: 10,
    });
  });

  it("fills the weekly and custom defaults into an old file, the weekly hour from the daily one", () => {
    const parsed = ScheduleFile.parse({ version: 1, hour: 9, cadence_days: 3, sections: null });
    expect(parsed.voice_id).toBeNull();
    expect(parsed.voice_id_b).toBeNull();
    expect(parsed.weekly).toEqual({
      enabled: true,
      day: 0,
      hour: 9,
      skip_topics: [],
      format: "readout",
      length_minutes: 10,
      voice_id: null,
      voice_id_b: null,
    });
    expect(parsed.custom).toEqual({
      skip_topics: [],
      format: "readout",
      length_minutes: 5,
      voice_id: null,
      voice_id_b: null,
    });
  });

  it("fills a partial weekly and keeps what was set", () => {
    const parsed = ScheduleFile.parse({
      ...DEFAULT_SCHEDULE,
      weekly: { day: 5, hour: 18, enabled: false },
      custom: { format: "discussion" },
    });
    expect(parsed.weekly).toMatchObject({ enabled: false, day: 5, hour: 18, length_minutes: 10 });
    expect(parsed.custom).toMatchObject({ format: "discussion", length_minutes: 5 });
    expect(ScheduleFile.parse(parsed)).toEqual(parsed);
  });

  it("accepts a voice id or null and refuses anything else", () => {
    const withVoice = ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, voice_id: "Ada_01-x" });
    expect(withVoice.success).toBe(true);
    for (const voice_id of ["", "has space", "a".repeat(65), "x/y"]) {
      expect(ScheduleFile.safeParse({ ...DEFAULT_SCHEDULE, voice_id }).success).toBe(false);
    }
  });

  it("refuses a weekly day outside 0 to 6, an hour outside 0 to 23 and the headlines type", () => {
    const weekly = (patch: object) => ({
      ...DEFAULT_SCHEDULE,
      weekly: { ...DEFAULT_SCHEDULE.weekly, ...patch },
    });
    expect(ScheduleFile.safeParse(weekly({ day: 7 })).success).toBe(false);
    expect(ScheduleFile.safeParse(weekly({ hour: 24 })).success).toBe(false);
    expect(ScheduleFile.safeParse(weekly({ format: "headlines" })).success).toBe(false);
    expect(ScheduleFile.safeParse(weekly({ day: 6, hour: 23, format: "discussion" })).success).toBe(
      true,
    );
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

  it("lets the schedule.set op carry any subset and refuses an empty one", () => {
    expect(ConfigOp.safeParse({ op: "schedule.set", hour: 9 }).success).toBe(true);
    expect(ConfigOp.safeParse({ op: "schedule.set", weekly: { day: 3 } }).success).toBe(true);
    expect(ConfigOp.safeParse({ op: "schedule.set", custom: { voice_id: "abc" } }).success).toBe(
      true,
    );
    expect(ConfigOp.safeParse({ op: "schedule.set" }).success).toBe(false);
    expect(ConfigOp.safeParse({ op: "schedule.set", weekly: { day: 9 } }).success).toBe(false);
  });

  it("lets the schedule.set op leave format and length out", () => {
    const set = { op: "schedule.set", hour: 9, cadence_days: 1, skip_topics: [] };
    expect(ConfigOp.safeParse(set).success).toBe(true);
    expect(ConfigOp.safeParse({ ...set, format: "headlines", length_minutes: 5 }).success).toBe(
      true,
    );
    expect(ConfigOp.safeParse({ ...set, length_minutes: 4 }).success).toBe(false);
  });
});

describe("schedule.set op", () => {
  it("parses and refuses an hour or cadence out of range", () => {
    const ok = { op: "schedule.set", hour: 9, cadence_days: 3, skip_topics: ["trending"] };
    expect(ConfigOp.safeParse(ok).success).toBe(true);
    expect(ConfigOp.safeParse({ ...ok, hour: 24 }).success).toBe(false);
    expect(ConfigOp.safeParse({ ...ok, cadence_days: 4 }).success).toBe(false);
    expect(ConfigOp.safeParse({ ...ok, skip_topics: undefined }).success).toBe(true);
    expect(ConfigOp.safeParse({ ...ok, skip_topics: ["Not An Id"] }).success).toBe(false);
  });
});

// If a schedule written before general topics could play reads them as in, the next scheduled
// briefing publishes World, Business and the rest the owner never chose.
describe("effectiveSkipTopics", () => {
  const file = ScheduleFile.parse({ version: 1, hour: 7, cadence_days: 2, skip_topics: ["ai"] });

  it("counts the general topics as skipped until general_scoped is set", () => {
    expect(effectiveSkipTopics(file, "daily")).toEqual([
      "ai",
      "world",
      "business",
      "science",
      "culture",
      "sports",
    ]);
    expect(effectiveSkipTopics(file, "weekly")).toHaveLength(5);
    const scoped = withGeneralScope(file);
    expect(scoped.general_scoped).toBe(true);
    expect(effectiveSkipTopics({ ...scoped, skip_topics: ["ai"] }, "daily")).toEqual(["ai"]);
  });
});
