import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countSources, FLAG_ODDS, isFlagged, readSourceCounts } from "../src/run/sourceCounts.js";

const flags = (hype: number, sponsored: number, funding = 0) => ({ hype, sponsored, funding });

describe("isFlagged", () => {
  it("counts hype or sponsored at even odds or more, and never funding", () => {
    expect(FLAG_ODDS).toBe(0.5);
    expect(isFlagged(flags(0.9, 0.1))).toBe(true);
    expect(isFlagged(flags(0.1, 0.9))).toBe(true);
    expect(isFlagged(flags(0.5, 0))).toBe(true);
    expect(isFlagged(flags(0.49, 0.49))).toBe(false);
    expect(isFlagged(flags(0.1, 0.1, 0.9))).toBe(false);
    expect(isFlagged(flags(0, 0, 1))).toBe(false);
  });
});

describe("countSources", () => {
  const poolSourceIds = new Map([
    ["i1", "a"],
    ["i2", "a"],
    ["i3", "a"],
    ["i4", "b"],
    ["i5", "b"],
  ]);

  it("counts what each source's judged items were flagged for", () => {
    const counts = countSources({
      fetchedBySource: { a: 9, b: 4, c: 2 },
      poolSourceIds,
      judgedIds: ["i1", "i2", "i3", "i4", "i5"],
      flags: new Map([
        ["i1", flags(0.9, 0.1)],
        ["i2", flags(0.1, 0.7)],
        ["i3", flags(0.1, 0.1, 0.95)],
        ["i4", flags(0.2, 0.3, 0.9)],
        ["i5", flags(0, 0)],
      ]),
      passedIds: new Set(["i3", "i5"]),
    });
    expect(counts).toEqual({
      a: { fetched: 9, judged: 3, passed: 1, flagged: 2 },
      b: { fetched: 4, judged: 2, passed: 1, flagged: 0 },
      c: { fetched: 2, judged: 0, passed: 0, flagged: 0 },
    });
  });

  it("counts flags only on judged items, and none for a judged item without flags", () => {
    const counts = countSources({
      fetchedBySource: undefined,
      poolSourceIds,
      judgedIds: ["i1", "i4"],
      flags: new Map([
        ["i2", flags(0.9, 0.9)],
        ["i3", flags(0.9, 0.9)],
        ["i5", flags(0.9, 0.9)],
      ]),
      passedIds: new Set(),
    });
    expect(counts.a).toEqual({ fetched: 3, judged: 1, passed: 0, flagged: 0 });
    expect(counts.b).toEqual({ fetched: 2, judged: 1, passed: 0, flagged: 0 });
  });
});

describe("readSourceCounts", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function file(content: unknown): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "source-counts-"));
    const path = join(dir, "source-counts.json");
    await writeFile(path, JSON.stringify(content));
    return path;
  }

  it("reads the flagged counter, and a pass file written before it was counted", async () => {
    const current = await file({
      version: 1,
      sources: { a: { fetched: 3, judged: 2, passed: 1, flagged: 1 } },
    });
    expect(await readSourceCounts(current)).toEqual({
      a: { fetched: 3, judged: 2, passed: 1, flagged: 1 },
    });
    await rm(dir, { recursive: true, force: true });
    const older = await file({ version: 1, sources: { a: { fetched: 3, judged: 2, passed: 1 } } });
    expect(await readSourceCounts(older)).toEqual({ a: { fetched: 3, judged: 2, passed: 1 } });
  });

  it("gives null for a missing or malformed file", async () => {
    const bad = await file({ version: 1, sources: { a: { fetched: 3, judged: -1, passed: 1 } } });
    expect(await readSourceCounts(bad)).toBeNull();
    expect(await readSourceCounts(join(dir, "missing.json"))).toBeNull();
  });
});
