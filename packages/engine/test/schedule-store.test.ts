import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCHEDULE } from "@dispatch/core";
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
      format: "headlines" as const,
      length_minutes: 5 as const,
      voice_id: "ada",
      voice_id_b: null,
      weekly: { ...DEFAULT_SCHEDULE.weekly, hour: 9, day: 5 },
      custom: { ...DEFAULT_SCHEDULE.custom },
      timezone: "Europe/Stockholm",
    };
    await writeFile(join(root, "config", "schedule.json"), serializeSchedule(saved));
    expect(await loadSchedule(root)).toEqual(saved);
  });

  it("reads a file written before format and length existed", async () => {
    const old = { version: 1, hour: 9, cadence_days: 7 };
    // A file of that age still carried `sections`, always null in use, which is dropped.
    await writeFile(
      join(root, "config", "schedule.json"),
      JSON.stringify({ ...old, sections: null }),
    );
    expect(await loadSchedule(root)).toEqual({
      ...old,
      skip_topics: [],
      format: "readout",
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
