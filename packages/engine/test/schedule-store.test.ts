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
    const saved = { version: 1 as const, hour: 9, cadence_days: 7 as const, sections: ["ai"] };
    await writeFile(join(root, "config", "schedule.json"), serializeSchedule(saved));
    expect(await loadSchedule(root)).toEqual(saved);
  });

  it("names the problem when the file is invalid", async () => {
    await writeFile(
      join(root, "config", "schedule.json"),
      JSON.stringify({ version: 1, hour: 30, cadence_days: 2, sections: null }),
    );
    await expect(loadSchedule(root)).rejects.toBeInstanceOf(ScheduleError);
  });
});
