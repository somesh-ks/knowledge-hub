import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCHEDULE } from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSchedule, ScheduleError, serializeSchedule } from "../src/schedule/store.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "schedule-"));
  await mkdir(join(root, "config"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadSchedule", () => {
  it("falls back to the defaults when the file is missing", async () => {
    expect(await loadSchedule(root)).toEqual(DEFAULT_SCHEDULE);
  });

  it("reads a saved schedule", async () => {
    const saved = {
      version: 1 as const,
      hour: 9,
      cadence_days: 7 as const,
      skip_topics: ["trending"],
      length_minutes: 5 as const,
      voice_id: "ada",
      voice_id_b: null,
      weekly: { ...DEFAULT_SCHEDULE.weekly, hour: 9, day: 5 },
      custom: { ...DEFAULT_SCHEDULE.custom },
      timezone: "Europe/Stockholm",
      enabled: false,
    };
    await writeFile(join(root, "config", "schedule.json"), serializeSchedule(saved));
    expect(await loadSchedule(root)).toEqual(saved);
  });

  // The file is written field by field: a field left out of the writer is lost on the next edit.
  it("keeps each podcast's lookback through a write and a read, and writes none while it is Auto", async () => {
    const saved = {
      ...DEFAULT_SCHEDULE,
      lookback_hours: 24 as const,
      weekly: { ...DEFAULT_SCHEDULE.weekly, lookback_hours: 168 as const },
    };
    await writeFile(join(root, "config", "schedule.json"), serializeSchedule(saved));
    const read = await loadSchedule(root);
    expect(read.lookback_hours).toBe(24);
    expect(read.weekly.lookback_hours).toBe(168);
    expect(serializeSchedule({ ...saved, lookback_hours: null })).toBe(
      serializeSchedule({ ...DEFAULT_SCHEDULE, weekly: saved.weekly }),
    );
    expect(serializeSchedule(DEFAULT_SCHEDULE)).not.toContain("lookback_hours");
  });

  it("reads a file written before length existed", async () => {
    const old = { version: 1, hour: 9, cadence_days: 7 };
    // A file of that age still carried `sections`, always null in use, which is dropped.
    await writeFile(
      join(root, "config", "schedule.json"),
      JSON.stringify({ ...old, sections: null }),
    );
    expect(await loadSchedule(root)).toEqual({
      ...old,
      enabled: true,
      skip_topics: [],
      length_minutes: 10,
      voice_id: null,
      voice_id_b: null,
      timezone: "Europe/Stockholm",
      weekly: { ...DEFAULT_SCHEDULE.weekly, hour: 9 },
      custom: DEFAULT_SCHEDULE.custom,
    });
  });

  it("names the problem when the file is invalid", async () => {
    await writeFile(
      join(root, "config", "schedule.json"),
      JSON.stringify({ version: 1, hour: 30, cadence_days: 2, sections: null }),
    );
    await expect(loadSchedule(root)).rejects.toBeInstanceOf(ScheduleError);
  });
});
