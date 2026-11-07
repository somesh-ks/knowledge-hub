import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readsStateAtStart } from "./configPaths.js";
import { saveStateIfOn } from "./stateSave.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-state-save-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("saving the run state with the commit (D381)", () => {
  // The bug it prevents: a failure record committed after a gate that never pulled (the store was
  // down) would try to push files with no pull record, and fail a second time for the same cause.
  it("sends nothing when this job never pulled", async () => {
    await expect(
      saveStateIfOn(root, "run", {
        DATABASE_URL: "postgres://unreachable",
        SINGULARITY_STATE_STORE: "postgres",
      }),
    ).resolves.toBeUndefined();
  });

  it("does nothing with the switch off", async () => {
    await expect(
      saveStateIfOn(root, "run", { DATABASE_URL: "postgres://unreachable" }),
    ).resolves.toBeUndefined();
  });
});

describe("which commands pull the run state", () => {
  // The bug it prevents: a second pull in the same checkout writes the stored rows over the spend
  // and timings an earlier podcast stage wrote but has not committed yet.
  it("pulls in a podcast's first stage only", () => {
    expect(readsStateAtStart("podcast", ["--request", "{}", "--stage", "select"])).toBe(true);
    expect(readsStateAtStart("podcast", ["--request", "{}"])).toBe(true);
    for (const stage of ["script", "cover", "publish"]) {
      expect(readsStateAtStart("podcast", ["--stage", stage])).toBe(false);
      expect(readsStateAtStart("podcast", [`--stage=${stage}`])).toBe(false);
    }
  });

  it("pulls for the run's gate, not its later stages or its failure record", () => {
    expect(readsStateAtStart("run", ["--stage", "gate"])).toBe(true);
    expect(readsStateAtStart("run", ["--stage", "commit"])).toBe(false);
    expect(readsStateAtStart("run", ["--record-failed"])).toBe(false);
    // The audio job pulls its own two files so its write is on the stored version (PR 3).
    expect(readsStateAtStart("publish", [])).toBe(true);
  });
});
