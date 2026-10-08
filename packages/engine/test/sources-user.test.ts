import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, type SourcesFile, type SourcesUserFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/commands/sources.js";
import { createLogger } from "../src/context.js";
import {
  loadSources,
  loadSourcesRaw,
  mergeUserSources,
  parseSources,
  saveUserSources,
  serializeSources,
  serializeUserSources,
} from "../src/sources/registry.js";
import {
  passRate,
  recordSourceStats,
  rollWindow,
  STATS_WINDOW_DAYS,
} from "../src/state/sourceStats.js";
import { makeSource } from "./fetch-helpers.js";

let root: string;

const SOURCES_MD = [
  "## 1. Blogs",
  "| Source | URL | Cadence |",
  "|---|---|---|",
  "| Alpha Notes | https://alpha.example | Weekly |",
].join("\n");

const added = makeSource({
  id: "quantum-weekly",
  name: "Quantum Weekly",
  url: "https://quantum.example/",
  feed_url: "https://quantum.example/feed.xml",
  origin: "auto",
  topic_ids: ["quantum_computing"],
  quality: { score: 0.72, scored_at: "2026-10-07T06:00:00.000Z" },
  pinned: true,
});

const USER: SourcesUserFile = {
  version: 1,
  added: [added],
  overrides: { "alpha-notes": { enabled: false } },
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-srcuser-"));
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(join(root, "config/sources.md"), SOURCES_MD);
  vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const context = () => ({
  root,
  env: loadEnv({}),
  log: createLogger({ json: false, secrets: [], write: () => {} }),
  json: false,
  now: () => new Date("2026-10-07T06:00:00Z"),
});

describe("config/sources.user.json", () => {
  it("survives regenerating sources.json from sources.md, and is never copied into it", async () => {
    expect(await run(["import"], context())).toBe(0);
    await saveUserSources(root, USER);
    const userText = await readFile(join(root, "config/sources.user.json"), "utf8");

    // Regenerate twice, once keeping discovered data and once from scratch.
    expect(await run(["import"], context())).toBe(0);
    expect(await run(["import", "--fresh"], context())).toBe(0);

    expect(await readFile(join(root, "config/sources.user.json"), "utf8")).toBe(userText);
    const raw = await loadSourcesRaw(root);
    expect(raw.sources.map((s) => s.id)).toContain("alpha-notes");
    expect(raw.sources.some((s) => s.id === "quantum-weekly")).toBe(false);
    expect(raw.sources.find((s) => s.id === "alpha-notes")?.enabled).toBe(true);

    const merged = await loadSources(root);
    expect(merged.sources.find((s) => s.id === "alpha-notes")?.enabled).toBe(false);
    expect(merged.sources.at(-1)).toMatchObject({ id: "quantum-weekly", enabled: true });
  });

  it("is not written into sources.json by discovery either", async () => {
    await run(["import"], context());
    await saveUserSources(root, USER);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await run(["discover", "--dry-run"], context());
    vi.unstubAllGlobals();
    const text = await readFile(join(root, "config/sources.json"), "utf8");
    expect(text).not.toContain("quantum-weekly");
  });

  it("reads as no edits when the file does not exist", async () => {
    await run(["import"], context());
    expect(await loadSources(root)).toEqual(await loadSourcesRaw(root));
  });

  it("keeps the new source fields through a save and a load", async () => {
    await run(["import"], context());
    await saveUserSources(root, USER);
    const merged = await loadSources(root);
    expect(merged.sources.find((s) => s.id === "quantum-weekly")).toMatchObject({
      pinned: true,
      origin: "auto",
      topic_ids: ["quantum_computing"],
      quality: { score: 0.72, scored_at: "2026-10-07T06:00:00.000Z" },
    });
    expect(serializeUserSources(USER).endsWith("\n")).toBe(true);
  });

  it("fails loudly on an added source its type cannot run", async () => {
    await run(["import"], context());
    await saveUserSources(root, {
      version: 1,
      added: [makeSource({ id: "broken", type: "rss", feed_url: null })],
      overrides: {},
    });
    await expect(loadSources(root)).rejects.toThrow(/rss needs feed_url/);
  });

  it("serializes seed sources without the new fields, so existing files keep their bytes", () => {
    const file: SourcesFile = parseSources({
      version: 1,
      sources: [makeSource({ id: "a" })],
    });
    expect(serializeSources(file)).not.toMatch(/pinned|origin|topic_ids|quality/);
  });

  it("applies overrides to seed and added sources alike", () => {
    const base = {
      version: 1 as const,
      sources: [makeSource({ id: "a" }), makeSource({ id: "b" })],
    };
    const merged = mergeUserSources(base, {
      version: 1,
      added: [makeSource({ id: "c" })],
      overrides: { a: { pinned: true }, c: { enabled: false }, b: { removed: true } },
    });
    expect(merged.sources.map((s) => [s.id, s.enabled, s.pinned])).toEqual([
      ["a", true, true],
      ["c", false, undefined],
    ]);
  });
});

describe("state/source-stats.json counters", () => {
  const counts = {
    a: { fetched: 10, judged: 8, passed: 4 },
    b: { fetched: 3, judged: 3, passed: 0 },
  };

  it("adds a pass to a source's counters and counts what published", () => {
    const first = recordSourceStats({ version: 1, sources: {} }, counts, ["a", "a"], "2026-10-07");
    expect(first.sources.a).toEqual({
      fetched: 10,
      judged: 8,
      passed: 4,
      published: 2,
      window_start: "2026-10-07",
    });
    const second = recordSourceStats(first, counts, ["b"], "2026-10-09");
    expect(second.sources.a).toMatchObject({ fetched: 20, judged: 16, passed: 8, published: 2 });
    expect(second.sources.b).toMatchObject({
      fetched: 6,
      published: 1,
      window_start: "2026-10-07",
    });
  });

  it("counts a published source that fetched nothing this pass", () => {
    const next = recordSourceStats({ version: 1, sources: {} }, {}, ["c"], "2026-10-07");
    expect(next.sources.c).toMatchObject({ fetched: 0, published: 1 });
  });

  it("halves the counters and restarts the window after 30 days", () => {
    const stat = { fetched: 41, judged: 21, passed: 11, published: 5, window_start: "2026-09-01" };
    expect(rollWindow(stat, "2026-09-30")).toBe(stat);
    expect(rollWindow(stat, "2026-10-01")).toEqual({
      fetched: 20,
      judged: 10,
      passed: 5,
      published: 2,
      window_start: "2026-10-01",
    });
    expect(STATS_WINDOW_DAYS).toBe(30);
    const rolled = recordSourceStats(
      { version: 1, sources: { a: stat } },
      counts,
      [],
      "2026-10-07",
    );
    expect(rolled.sources.a).toMatchObject({ fetched: 30, window_start: "2026-10-07" });
  });

  it("leaves sources with no activity alone", () => {
    const stat = { fetched: 1, judged: 1, passed: 1, published: 1, window_start: "2026-01-01" };
    const next = recordSourceStats(
      { version: 1, sources: { idle: stat } },
      counts,
      [],
      "2026-10-07",
    );
    expect(next.sources.idle).toBe(stat);
  });

  it("reports the pass rate, or nothing before anything is judged", () => {
    expect(passRate(undefined)).toBeNull();
    expect(
      passRate({ fetched: 5, judged: 0, passed: 0, published: 0, window_start: "2026-10-07" }),
    ).toBeNull();
    expect(
      passRate({ fetched: 5, judged: 4, passed: 1, published: 0, window_start: "2026-10-07" }),
    ).toBe(0.25);
  });
});
