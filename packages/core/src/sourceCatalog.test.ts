import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDigestFile } from "./digestFile.js";
import { parseEpisodeFile } from "./podcast.js";
import { parseSourceCatalog } from "./sourceCatalog.js";
import { SourcesFile, SourcesUserFile } from "./sources.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const key = (url: string): string => {
  const u = new URL(url);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
};

describe("config/source-catalog.json", () => {
  const catalog = parseSourceCatalog(read("config/source-catalog.json"));

  // About thirty since D69 moved eleven of its feeds into the registry.
  it("holds about thirty feeds with unique ids", () => {
    expect(catalog.sources.length).toBeGreaterThanOrEqual(30);
    expect(new Set(catalog.sources.map((s) => s.id)).size).toBe(catalog.sources.length);
    expect(catalog.sources.every((s) => s.feed_url.startsWith("http"))).toBe(true);
  });

  it("rejects an entry with no feed_url and a duplicate id", () => {
    const base = {
      id: "a",
      name: "A",
      url: "https://a.example",
      about: "x",
      cadence: "daily",
      tags: ["a"],
    };
    expect(() => parseSourceCatalog({ version: 1, sources: [base] })).toThrow();
    const ok = { ...base, feed_url: "https://a.example/feed" };
    expect(() => parseSourceCatalog({ version: 1, sources: [ok, ok] })).toThrow();
  });

  it("duplicates nothing already in the registry", () => {
    const registry = SourcesFile.parse(read("config/sources.json")).sources;
    const user = existsSync(join(ROOT, "config/sources.user.json"))
      ? SourcesUserFile.parse(read("config/sources.user.json")).added
      : [];
    const known = new Set(
      [...registry, ...user].flatMap((s) => [key(s.url), ...(s.feed_url ? [key(s.feed_url)] : [])]),
    );
    const ids = new Set([...registry, ...user].map((s) => s.id));
    for (const s of catalog.sources) {
      expect(known.has(key(s.feed_url)), s.id).toBe(false);
      expect(known.has(key(s.url)), s.id).toBe(false);
      expect(ids.has(s.id), s.id).toBe(false);
    }
  });
});

describe("committed briefings and episodes", () => {
  const walk = (dir: string): string[] => {
    try {
      return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" }).map((p) =>
        join(dir, p),
      );
    } catch {
      return [];
    }
  };
  it("all parse", () => {
    for (const f of walk("Digests").filter((p) => /\d\.md$/.test(p))) {
      expect(() => parseDigestFile(readFileSync(join(ROOT, f), "utf8")), f).not.toThrow();
    }
    for (const f of walk("Podcasts").filter((p) => p.endsWith(".md"))) {
      expect(() => parseEpisodeFile(readFileSync(join(ROOT, f), "utf8")), f).not.toThrow();
    }
  });
});
