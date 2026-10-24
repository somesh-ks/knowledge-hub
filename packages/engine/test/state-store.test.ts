import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JudgmentEntry,
  type JudgmentsFile,
  type LastRunFile,
  type SeenFile,
} from "@singularity/core";
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
  root = await mkdtemp(join(tmpdir(), "singularity-state-"));
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

  it("round-trips a judgment that carries a launch scale", async () => {
    const judgments: JudgmentsFile = {
      version: 1,
      entries: {
        "abc123def456:q2:jev": {
          item_id: "abc123def456",
          model: "jev-latest",
          questions_hash: "q2",
          judged_at: "2026-10-08T05:13:00.000Z",
          category_probs: {
            ...CATEGORY_PROBS,
            design_engineering_craft: 0,
            consumer_tech_releases: 0.7,
          },
          craft_depth: 0.1,
          launch_scale: 0.75,
          flags: { hype: 0.1, sponsored: 0, funding: 0 },
        },
      },
    };
    await writeJudgments(root, judgments);
    expect(await readJudgments(root)).toEqual(judgments);
    expect(await text("state/judgments.json")).toContain('"launch_scale": 0.75');
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

describe("judgments cached before the consumer tech category", () => {
  /** An entry exactly as the cache held it: eleven probabilities and no launch scale. */
  const oldEntry = (): Record<string, unknown> => {
    const {
      consumer_tech_releases: _tech,
      software_engineering_depth: _software,
      ...elevenKeys
    } = CATEGORY_PROBS;
    return {
      item_id: "abc123def456",
      model: "jev-latest",
      questions_hash: "7a9fc1606ea2",
      judged_at: "2026-10-07T11:49:39.224Z",
      category_probs: elevenKeys,
      craft_depth: 0.24,
      flags: { hype: 0.03, sponsored: 0.02, funding: 0.01 },
    };
  };

  it("parses an entry without the new category key, reading it as probability 0", () => {
    const raw = oldEntry();
    expect(Object.keys(raw.category_probs as object)).toHaveLength(11);
    const entry = JudgmentEntry.parse(raw);
    expect(Object.keys(entry.category_probs)).toHaveLength(13);
    expect(entry.category_probs.software_engineering_depth).toBe(0);
    expect(entry.category_probs.consumer_tech_releases).toBe(0);
    expect(entry.category_probs.design_engineering_craft).toBe(0.7);
    expect(entry).not.toHaveProperty("launch_scale");
  });

  it("reads an old state file and writes it back with the full set of keys", async () => {
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      join(root, "state/judgments.json"),
      JSON.stringify({
        version: 1,
        entries: { "abc123def456:7a9fc1606ea2:jev-latest": oldEntry() },
      }),
    );
    const read = await readJudgments(root);
    await writeJudgments(root, read);
    const written = await text("state/judgments.json");
    expect(written).toContain('"consumer_tech_releases": 0');
    expect(written).not.toContain("launch_scale");
    expect(await readJudgments(root)).toEqual(read);
  });

  it("still rejects a probability out of range, an unknown key and a non-object", () => {
    const tooBig = { ...oldEntry(), category_probs: { ...CATEGORY_PROBS, none: 1.5 } };
    expect(JudgmentEntry.safeParse(tooBig).success).toBe(false);
    const unknown = { ...oldEntry(), category_probs: { ...CATEGORY_PROBS, memes: 0.1 } };
    expect(JudgmentEntry.safeParse(unknown).success).toBe(false);
    for (const bad of [null, "nope", [0.5], 3]) {
      expect(JudgmentEntry.safeParse({ ...oldEntry(), category_probs: bad }).success).toBe(false);
    }
    const badScale = { ...oldEntry(), launch_scale: 1.2 };
    expect(JudgmentEntry.safeParse(badScale).success).toBe(false);
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
