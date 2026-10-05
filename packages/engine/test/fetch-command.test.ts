import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, type SourcesFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/commands/fetch.js";
import { type CommandContext, createLogger } from "../src/context.js";
import { PoolFile } from "../src/fetch/pool.js";
import { serializeSources } from "../src/sources/registry.js";
import { fixture, makeSource } from "./fetch-helpers.js";

const NOW = new Date("2026-10-06T06:00:00Z");
let root: string;
let stdout: string[];

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    root,
    env: loadEnv({}),
    log: createLogger({ json: false, secrets: [], write: () => {} }),
    json: false,
    now: () => NOW,
    ...overrides,
  };
}

const sources = (): SourcesFile => ({
  version: 1,
  sources: [
    makeSource({
      id: "typography",
      name: "Typography Notes",
      url: "https://notes.example/",
      feed_url: "https://notes.example/feed.xml",
      high_signal: true,
    }),
    makeSource({
      id: "repo",
      name: "Springlet",
      type: "github",
      url: "https://github.com/acme/springlet/releases",
      feed_url: "https://github.com/acme/springlet/releases.atom",
      options: { repo: "acme/springlet" },
    }),
    makeSource({
      id: "journal",
      name: "Journal",
      type: "crossref",
      tier: "weekly",
      url: "https://example.org",
      feed_url: "https://api.crossref.org/journals/2573-0142/works",
      options: { issn: "2573-0142" },
    }),
    makeSource({
      id: "scrape",
      name: "Scrape",
      type: "firecrawl",
      url: "https://scrape.example/blog",
      feed_url: null,
    }),
  ],
});

function routeFetch(extra: Record<string, () => Response> = {}): void {
  const routes: Record<string, () => Response> = {
    // Overrides come first because the first matching prefix wins.
    ...extra,
    "https://notes.example/feed.xml": () => new Response(fixture("fetch-rdf-rss1.xml")),
    "https://github.com/acme/springlet/releases.atom": () =>
      new Response(fixture("fetch-github-releases.atom")),
    "https://api.crossref.org/": () => new Response(fixture("fetch-crossref.json")),
  };
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
  root = await mkdtemp(join(tmpdir(), "dispatch-fetch-"));
  await mkdir(join(root, "config"), { recursive: true });
  const preferences = await readFile(
    new URL("../../../config/preferences.json", import.meta.url),
    "utf8",
  );
  await writeFile(join(root, "config/preferences.json"), preferences);
  await writeFile(join(root, "config/sources.json"), serializeSources(sources()));
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  routeFetch();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const readPool = async (rel: string): Promise<PoolFile> =>
  PoolFile.parse(JSON.parse(await readFile(join(root, rel), "utf8")));

describe("dispatch fetch", () => {
  it("writes a validated pool to .cache/run/<id>/pool.json and prints counts only", async () => {
    const code = await run(["--since", "2026-10-01T00:00:00Z"], context());
    expect(code).toBe(0);
    const pool = await readPool(".cache/run/2026-10-06/pool.json");
    expect(pool).toMatchObject({
      id: "2026-10-06",
      kind: "regular",
      generated_at: NOW.toISOString(),
    });
    expect(pool.window).toEqual({ from: "2026-10-01T00:00:00.000Z", to: NOW.toISOString() });
    expect(pool.items.length).toBeGreaterThan(0);
    // The typography source is high signal, so its dated items survive the prefilter.
    expect(pool.items.some((i) => i.source_id === "typography")).toBe(true);
    const out = stdout.join("");
    expect(out).toContain("pool 2026-10-06 (regular)");
    expect(out).toContain("sources:");
    expect(out).not.toContain("Optical sizes");
  });

  it("runs daily sources only, and records skipped scrape sources as notes", async () => {
    await run(["--since", "2026-10-01T00:00:00Z"], context());
    const pool = await readPool(".cache/run/2026-10-06/pool.json");
    expect(pool.sources.map((s) => s.source_id).sort()).toEqual(["repo", "scrape", "typography"]);
    expect(pool.sources.find((s) => s.source_id === "scrape")).toMatchObject({
      ok: true,
      count: 0,
    });
    expect(pool.sources.find((s) => s.source_id === "scrape")?.note).toMatch(/FIRECRAWL_API_KEY/);
  });

  it("includes weekly sources and a -weekly id with --weekly", async () => {
    expect(await run(["--weekly"], context())).toBe(0);
    const pool = await readPool(".cache/run/2026-10-06-weekly/pool.json");
    expect(pool.kind).toBe("weekly");
    expect(pool.sources.map((s) => s.source_id)).toContain("journal");
    // The weekly window is seven days.
    expect(Date.parse(pool.window.to) - Date.parse(pool.window.from)).toBe(7 * 86_400_000);
  });

  it("starts the window at the last successful fetch", async () => {
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      join(root, "state/last-run.json"),
      JSON.stringify({ version: 1, last_fetch_at: "2026-10-05T05:13:00.000Z" }),
    );
    await run([], context());
    expect((await readPool(".cache/run/2026-10-06/pool.json")).window.from).toBe(
      "2026-10-05T05:13:00.000Z",
    );
  });

  it("drops items already in seen.json", async () => {
    await run(["--since", "2026-10-01T00:00:00Z"], context());
    const first = await readPool(".cache/run/2026-10-06/pool.json");
    const shown = first.items[0];
    if (!shown) throw new Error("expected at least one item");
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(
      join(root, "state/seen.json"),
      JSON.stringify({ version: 1, items: { [shown.id]: "2026-10-04" } }),
    );
    await run(["--since", "2026-10-01T00:00:00Z", "--id", "2026-10-06-2"], context());
    const second = await readPool(".cache/run/2026-10-06-2/pool.json");
    expect(second.items.some((i) => i.id === shown.id)).toBe(false);
    expect(second.report.dedupe.already_seen).toBe(1);
  });

  it("takes the next free digest id when one exists for the day", async () => {
    await mkdir(join(root, "Digests/2026/10"), { recursive: true });
    await writeFile(join(root, "Digests/2026/10/2026-10-06.md"), "x");
    await run(["--since", "2026-10-01T00:00:00Z"], context());
    expect(existsSync(join(root, ".cache/run/2026-10-06-2/pool.json"))).toBe(true);
  });

  it("writes to --out when given", async () => {
    await run(["--since", "2026-10-01T00:00:00Z", "--out", "custom/pool.json"], context());
    expect(existsSync(join(root, "custom/pool.json"))).toBe(true);
    expect(existsSync(join(root, ".cache"))).toBe(false);
  });

  it("prints a single JSON object with --json", async () => {
    await run(["--since", "2026-10-01T00:00:00Z"], context({ json: true }));
    const parsed = JSON.parse(stdout.join("")) as {
      id: string;
      sources: { run: number };
      kept: number;
    };
    expect(parsed.id).toBe("2026-10-06");
    expect(parsed.sources.run).toBe(3);
    expect(typeof parsed.kept).toBe("number");
  });

  it("does not change state files, and updates source health only when asked", async () => {
    const before = await readFile(join(root, "config/sources.json"), "utf8");
    await run(["--since", "2026-10-01T00:00:00Z"], context());
    expect(await readFile(join(root, "config/sources.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, "state"))).toBe(false);
    await run(["--since", "2026-10-01T00:00:00Z", "--update-health"], context());
    const updated = JSON.parse(
      await readFile(join(root, "config/sources.json"), "utf8"),
    ) as SourcesFile;
    expect(updated.sources.find((s) => s.id === "typography")?.last_ok).toBe(NOW.toISOString());
  });

  it("exits 0 when some sources fail and reports them", async () => {
    routeFetch({ "https://github.com/": () => new Response("down", { status: 500 }) });
    const warnings: string[] = [];
    const log = createLogger({ json: false, secrets: [], write: (line) => warnings.push(line) });
    expect(await run(["--since", "2026-10-01T00:00:00Z"], context({ log }))).toBe(0);
    const pool = await readPool(".cache/run/2026-10-06/pool.json");
    expect(pool.sources.find((s) => s.source_id === "repo")?.ok).toBe(false);
    expect(warnings.join("\n")).toContain("source repo failed");
  });

  it("exits 1 when every source fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    expect(await run(["--since", "2026-10-01T00:00:00Z"], context())).toBe(1);
  });

  it("exits 2 for unknown options and an invalid --since", async () => {
    expect(await run(["--nope"], context())).toBe(2);
    expect(await run(["--since", "last tuesday"], context())).toBe(2);
    expect(await run(["--since", "2027-01-01T00:00:00Z"], context())).toBe(2);
  });

  it("exits 1 with a clear message when the registry is missing", async () => {
    await rm(join(root, "config/sources.json"));
    const messages: string[] = [];
    const log = createLogger({ json: false, secrets: [], write: (line) => messages.push(line) });
    expect(await run([], context({ log }))).toBe(1);
    expect(messages.join("\n")).toContain("dispatch sources import");
  });

  it("prints usage for --help without touching the network", async () => {
    const calls = vi.mocked(fetch).mock.calls.length;
    expect(await run(["--help"], context())).toBe(0);
    expect(stdout.join("")).toContain("Usage: dispatch fetch");
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });
});
