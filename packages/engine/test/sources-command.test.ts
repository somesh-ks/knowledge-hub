import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, type SourcesFile } from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/commands/sources.js";
import { type CommandContext, createLogger } from "../src/context.js";
import { serializeSources } from "../src/sources/registry.js";
import { fixture, makeSource } from "./fetch-helpers.js";

let root: string;
let stdout: string[];
let errors: string[];

function context(json = false): CommandContext {
  return {
    root,
    env: loadEnv({}),
    log: createLogger({ json: false, secrets: [], write: (line) => errors.push(line) }),
    json,
    now: () => new Date("2026-10-06T06:00:00Z"),
  };
}

const SOURCES_MD = [
  "## 1. Blogs",
  "| Source | URL | Cadence |",
  "|---|---|---|",
  "| Alpha Notes | https://alpha.example | Weekly |",
  "| Beta Journal | https://beta.example/blog | Monthly |",
  "## 7. Exa Search Queries",
  "```text",
  '"design tokens specification 2026"',
  "```",
].join("\n");

const readJson = async <T>(rel: string): Promise<T> =>
  JSON.parse(await readFile(join(root, rel), "utf8")) as T;

function stubFetch(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return key ? (routes[key] as () => Response)() : new Response("not found", { status: 404 });
    }),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-srccmd-"));
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(join(root, "config/sources.md"), SOURCES_MD);
  stdout = [];
  errors = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("singularity sources import", () => {
  it("writes config/sources.json and config/queries.json from the markdown, offline", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect(await run(["import"], context())).toBe(0);
    const file = await readJson<SourcesFile>("config/sources.json");
    expect(file.sources.map((s) => s.id)).toContain("alpha-notes");
    expect(file.sources.find((s) => s.id === "beta-journal")?.tier).toBe("weekly");
    const queries = await readJson<{ queries: { query: string }[] }>("config/queries.json");
    expect(queries.queries.map((q) => q.query)).toEqual(["design tokens specification"]);
    expect(network).not.toHaveBeenCalled();
    expect(stdout.join("")).toContain("config/sources.json");
  });

  it("writes nothing with --dry-run", async () => {
    expect(await run(["import", "--dry-run"], context())).toBe(0);
    expect(existsSync(join(root, "config/sources.json"))).toBe(false);
    expect(existsSync(join(root, "config/queries.json"))).toBe(false);
  });

  it("keeps discovered feeds on a second import and never overwrites hand-edited queries", async () => {
    await run(["import"], context());
    const file = await readJson<SourcesFile>("config/sources.json");
    const alpha = file.sources.find((s) => s.id === "alpha-notes");
    if (!alpha) throw new Error("alpha-notes missing");
    await writeFile(
      join(root, "config/sources.json"),
      serializeSources({
        version: 1,
        sources: file.sources.map((s) =>
          s.id === "alpha-notes"
            ? { ...s, type: "rss" as const, feed_url: "https://alpha.example/feed.xml" }
            : s,
        ),
      }),
    );
    await writeFile(
      join(root, "config/queries.json"),
      JSON.stringify({ version: 1, queries: [{ id: "mine", query: "my own query" }] }),
    );
    await run(["import"], context());
    expect(
      (await readJson<SourcesFile>("config/sources.json")).sources.find(
        (s) => s.id === "alpha-notes",
      ),
    ).toMatchObject({ type: "rss", feed_url: "https://alpha.example/feed.xml" });
    expect(
      (await readJson<{ queries: { id: string }[] }>("config/queries.json")).queries[0]?.id,
    ).toBe("mine");
  });

  it("starts over with --fresh", async () => {
    await run(["import"], context());
    await writeFile(
      join(root, "config/sources.json"),
      serializeSources({ version: 1, sources: [makeSource({ id: "extra" })] }),
    );
    await run(["import", "--fresh"], context());
    expect(
      (await readJson<SourcesFile>("config/sources.json")).sources.some((s) => s.id === "extra"),
    ).toBe(false);
  });

  it("prints JSON counts with --json", async () => {
    await run(["import", "--dry-run"], context(true));
    const parsed = JSON.parse(stdout.join("")) as { total: number; queries: number };
    expect(parsed.queries).toBe(1);
    expect(parsed.total).toBeGreaterThan(10);
  });
});

describe("singularity sources discover", () => {
  it("fills in feeds from the network and writes the registry", async () => {
    await run(["import"], context());
    stubFetch({
      "https://alpha.example/rss.xml": () => new Response(fixture("fetch-rss2-comeau.xml")),
      "https://alpha.example": () =>
        new Response(
          `<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>`,
        ),
    });
    expect(await run(["discover", "--only", "alpha-notes"], context())).toBe(0);
    const file = await readJson<SourcesFile>("config/sources.json");
    expect(file.sources.find((s) => s.id === "alpha-notes")).toMatchObject({
      type: "rss",
      feed_url: "https://alpha.example/rss.xml",
    });
    expect(stdout.join("")).toContain("feed");
  });

  it("changes nothing with --dry-run", async () => {
    await run(["import"], context());
    const before = await readFile(join(root, "config/sources.json"), "utf8");
    stubFetch({
      "https://alpha.example/rss.xml": () => new Response(fixture("fetch-rss2-comeau.xml")),
      "https://alpha.example": () =>
        new Response(
          `<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>`,
        ),
    });
    await run(["discover", "--dry-run", "--only", "alpha-notes"], context());
    expect(await readFile(join(root, "config/sources.json"), "utf8")).toBe(before);
  });
});

describe("singularity sources check", () => {
  beforeEach(async () => {
    await writeFile(
      join(root, "config/sources.json"),
      serializeSources({
        version: 1,
        sources: [
          makeSource({ id: "up", feed_url: "https://up.example/feed.xml" }),
          makeSource({ id: "down", feed_url: "https://down.example/feed.xml" }),
          makeSource({ id: "off", feed_url: "https://off.example/feed.xml", enabled: false }),
        ],
      }),
    );
    stubFetch({
      "https://up.example/": () => new Response("<rss/>"),
      "https://down.example/": () => new Response("no", { status: 503 }),
    });
  });

  it("reports reachability for enabled sources and exits 0 by default", async () => {
    expect(await run(["check"], context())).toBe(0);
    const out = stdout.join("");
    expect(out).toContain("checked 2 sources: 1 reachable, 1 failing");
    expect(out).toContain("down");
    expect(out).not.toContain("off.example");
  });

  it("exits 1 with --strict when any source fails", async () => {
    expect(await run(["check", "--strict"], context())).toBe(1);
  });

  it("can be limited to some sources", async () => {
    expect(await run(["check", "--only", "up", "--strict"], context())).toBe(0);
  });
});

describe("singularity sources usage", () => {
  it("shows usage and exits 2 without a subcommand, exits 2 for an unknown one", async () => {
    expect(await run([], context())).toBe(2);
    expect(stdout.join("")).toContain("Usage: singularity sources");
    expect(await run(["frobnicate"], context())).toBe(2);
    expect(errors.join("\n")).toContain('unknown subcommand "frobnicate"');
  });

  it("exits 2 for an unknown flag and 0 for help", async () => {
    expect(await run(["import", "--bogus"], context())).toBe(2);
    expect(await run(["help"], context())).toBe(0);
  });

  it("exits 1 when the registry is needed but missing", async () => {
    expect(await run(["discover"], context())).toBe(1);
    expect(errors.join("\n")).toContain("singularity sources import");
  });
});
