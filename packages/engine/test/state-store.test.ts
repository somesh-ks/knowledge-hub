import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgmentsFile, LastRunFile, SeenFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/state/atomicWrite.js";
import { stableStringify } from "../src/state/stableJson.js";
import {
  defaultUsage,
  readJudgments,
  readLastRun,
  readSeen,
  readUsage,
  StateError,
  writeJudgments,
  writeLastRun,
  writeSeen,
  writeUsage,
} from "../src/state/store.js";
import { CATEGORY_PROBS } from "./fetch-helpers.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-state-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const text = (rel: string): Promise<string> => readFile(join(root, rel), "utf8");

describe("defaults when files are absent", () => {
  it("returns empty documents without creating files", async () => {
    expect(await readSeen(root)).toEqual({ version: 1, items: {} });
    expect(await readJudgments(root)).toEqual({ version: 1, entries: {} });
    expect(await readLastRun(root)).toEqual({ version: 1 });
    expect(await readUsage(root, new Date("2026-10-06T10:00:00Z"))).toEqual({
      version: 1,
      speechify: { month: "2026-10", characters: 0 },
    });
    await expect(readdir(join(root, "state"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a fresh object each time so callers cannot corrupt the default", async () => {
    const first = await readSeen(root);
    first.items.x = "2026-10-01";
    expect(await readSeen(root)).toEqual({ version: 1, items: {} });
  });
});

describe("round trips", () => {
  it("writes and reads seen.json, creating the state directory", async () => {
    const seen: SeenFile = { version: 1, items: { abc123def456: "2026-10-05" } };
    await writeSeen(root, seen);
    expect(await readSeen(root)).toEqual(seen);
  });

  it("writes and reads judgments.json", async () => {
    const judgments: JudgmentsFile = {
      version: 1,
      entries: {
        "abc123def456:q1:jev": {
          item_id: "abc123def456",
          model: "jev-latest",
          questions_hash: "q1",
          judged_at: "2026-10-05T05:13:00.000Z",
          category_probs: CATEGORY_PROBS,
          craft_depth: 0.6,
          flags: { hype: 0.1, sponsored: 0, funding: 0 },
        },
      },
    };
    await writeJudgments(root, judgments);
    expect(await readJudgments(root)).toEqual(judgments);
  });

  it("writes and reads last-run.json and usage.json", async () => {
    const lastRun: LastRunFile = {
      version: 1,
      regular: {
        at: "2026-10-05T05:13:00.000Z",
        outcome: "published",
        digest_id: "2026-10-05",
        items: 11,
      },
      last_fetch_at: "2026-10-05T05:13:00.000Z",
    };
    await writeLastRun(root, lastRun);
    expect(await readLastRun(root)).toEqual(lastRun);
    await writeUsage(root, defaultUsage(new Date("2026-10-06T00:00:00Z")));
    expect((await readUsage(root, new Date())).speechify.month).toBe("2026-10");
  });
});

describe("clean diffs", () => {
  it("writes two-space JSON with a trailing newline and version first", async () => {
    await writeSeen(root, { version: 1, items: { b: "2026-10-02", a: "2026-10-01" } });
    expect(await text("state/seen.json")).toBe(
      '{\n  "version": 1,\n  "items": {\n    "a": "2026-10-01",\n    "b": "2026-10-02"\n  }\n}\n',
    );
  });

  it("produces identical bytes whatever order keys were inserted in", async () => {
    await writeSeen(root, {
      version: 1,
      items: { c: "2026-10-03", a: "2026-10-01", b: "2026-10-02" },
    });
    const first = await text("state/seen.json");
    await writeSeen(root, {
      version: 1,
      items: { b: "2026-10-02", c: "2026-10-03", a: "2026-10-01" },
    });
    expect(await text("state/seen.json")).toBe(first);
  });

  it("sorts nested keys and leaves array order alone", () => {
    expect(stableStringify({ z: 1, a: { y: [3, 1, 2], b: 1 }, version: 1 })).toBe(
      '{\n  "version": 1,\n  "a": {\n    "b": 1,\n    "y": [\n      3,\n      1,\n      2\n    ]\n  },\n  "z": 1\n}\n',
    );
  });

  it("does not write a byte order mark", async () => {
    await writeLastRun(root, { version: 1 });
    expect((await readFile(join(root, "state/last-run.json")))[0]).toBe("{".charCodeAt(0));
  });
});

describe("atomic writes", () => {
  it("leaves no temporary files behind", async () => {
    await writeSeen(root, { version: 1, items: {} });
    await writeSeen(root, { version: 1, items: { a: "2026-10-01" } });
    expect(await readdir(join(root, "state"))).toEqual(["seen.json"]);
  });

  it("cleans up its temporary file when the final rename fails", async () => {
    await mkdir(join(root, "state", "seen.json"), { recursive: true });
    await expect(writeSeen(root, { version: 1, items: {} })).rejects.toThrow();
    expect(await readdir(join(root, "state"))).toEqual(["seen.json"]);
  });

  it("replaces an existing file in one step", async () => {
    const path = join(root, "x", "file.txt");
    await writeFileAtomic(path, "one\n");
    await writeFileAtomic(path, "two\n");
    expect(await readFile(path, "utf8")).toBe("two\n");
  });
});

describe("validation", () => {
  it("rejects invalid JSON with the file name", async () => {
    await mkdir(join(root, "state"));
    await writeFile(join(root, "state/seen.json"), "{ nope");
    await expect(readSeen(root)).rejects.toThrow(StateError);
    await expect(readSeen(root)).rejects.toThrow(/state\/seen\.json: not valid JSON/);
  });

  it("rejects a file that does not match the schema and names the field", async () => {
    await mkdir(join(root, "state"));
    await writeFile(
      join(root, "state/seen.json"),
      JSON.stringify({ version: 1, items: { a: "yesterday" } }),
    );
    await expect(readSeen(root)).rejects.toThrow(/items\.a/);
  });

  it("refuses to write an invalid document and leaves the old file intact", async () => {
    await writeSeen(root, { version: 1, items: { a: "2026-10-01" } });
    const bad = { version: 1, items: { a: "not-a-date" } } as SeenFile;
    await expect(writeSeen(root, bad)).rejects.toThrow();
    expect((await readSeen(root)).items).toEqual({ a: "2026-10-01" });
  });
});
