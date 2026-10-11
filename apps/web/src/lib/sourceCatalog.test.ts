import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cadenceLabel,
  catalogLine,
  freshOffers,
  loadSourceCatalog,
  parseSourceCatalog,
} from "./sourceCatalog";

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "nngroup",
  name: "Nielsen Norman Group",
  url: "https://www.nngroup.com",
  feed_url: "https://www.nngroup.com/feed/rss/",
  about: "UX research articles and usability guidance",
  cadence: "several a week",
  tags: ["design", "UX", "research", "design"],
  ...overrides,
});

describe("parseSourceCatalog", () => {
  it("reads the contract's shape, lowercasing tags and dropping repeats", () => {
    expect(parseSourceCatalog({ version: 1, sources: [entry()] })).toEqual([
      {
        id: "nngroup",
        name: "Nielsen Norman Group",
        feed_url: "https://www.nngroup.com/feed/rss/",
        about: "UX research articles and usability guidance",
        cadence: "several a week",
        tags: ["design", "ux", "research"],
      },
    ]);
  });

  it("is empty for a file that is missing, malformed or has no sources", () => {
    for (const file of [null, undefined, "x", [], {}, { sources: "no" }, { sources: [] }]) {
      expect(parseSourceCatalog(file)).toEqual([]);
    }
  });

  it("skips an entry that cannot be offered, and keeps the rest", () => {
    const kept = entry({ id: "kept" });
    const found = parseSourceCatalog({
      sources: [
        null,
        entry({ id: "Bad Id" }),
        entry({ id: "" }),
        entry({ id: "no-name", name: " " }),
        entry({ id: "no-feed", feed_url: "ftp://example.com/feed" }),
        entry({ id: "no-feed-2", feed_url: "not a url" }),
        entry({ id: "no-tags", tags: [] }),
        entry({ id: "tags-wrong", tags: "design" }),
        kept,
        entry({ id: "kept" }),
      ],
    });
    expect(found.map((source) => source.id)).toEqual(["kept"]);
  });

  it("keeps an entry with an unknown cadence or no description, and says nothing for them", () => {
    const [source] = parseSourceCatalog({
      sources: [entry({ cadence: "hourly", about: undefined })],
    });
    expect(source).toMatchObject({ cadence: null, about: "" });
    expect(catalogLine(source as NonNullable<typeof source>)).toBe("");
  });
});

describe("cadenceLabel and catalogLine", () => {
  it("name each cadence in a phrase", () => {
    expect(cadenceLabel("daily")).toBe("Posts daily");
    expect(cadenceLabel("several a week")).toBe("Posts several times a week");
    expect(cadenceLabel("weekly")).toBe("Posts weekly");
    expect(cadenceLabel("monthly")).toBe("Posts monthly");
    expect(cadenceLabel(null)).toBe("");
  });

  it("put what the source covers before how often it posts", () => {
    expect(catalogLine({ about: "UX research", cadence: "weekly" })).toBe(
      "UX research · Posts weekly",
    );
    expect(catalogLine({ about: "UX research", cadence: null })).toBe("UX research");
  });
});

describe("loadSourceCatalog", () => {
  const folders: string[] = [];
  afterEach(async () => {
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true })));
  });

  async function repoWith(path: string[], content?: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "catalog-"));
    folders.push(root);
    await mkdir(join(root, ...path), { recursive: true });
    if (content !== undefined) await writeFile(join(root, ...path, "source-catalog.json"), content);
    return root;
  }

  it("reads config/source-catalog.json under the root", async () => {
    const root = await repoWith(["config"], JSON.stringify({ sources: [entry()] }));
    expect((await loadSourceCatalog({ root, env: {} })).map((source) => source.id)).toEqual([
      "nngroup",
    ]);
  });

  it("is an empty list when the file is missing or is not JSON", async () => {
    expect(await loadSourceCatalog({ root: await repoWith(["config"]), env: {} })).toEqual([]);
    expect(
      await loadSourceCatalog({ root: await repoWith(["config"], "{not json"), env: {} }),
    ).toEqual([]);
  });

  it("reads the invented catalogue under the fixtures when fixtures are on", async () => {
    const root = await repoWith(
      ["apps", "web", "src", "fixtures", "config"],
      JSON.stringify({ sources: [entry({ id: "fixture-one" })] }),
    );
    const found = await loadSourceCatalog({ root, env: { DISPATCH_FIXTURES: "1" } });
    expect(found.map((source) => source.id)).toEqual(["fixture-one"]);
    // Without the switch the same root has no real catalogue.
    expect(await loadSourceCatalog({ root, env: {} })).toEqual([]);
  });
});

describe("freshOffers", () => {
  const offer = (id: string, feed: string) => ({
    id,
    name: id,
    feed_url: feed,
    about: "",
    cadence: null,
    tags: ["design"],
  });

  it("leaves out an offer whose site is already a source, www or not", () => {
    const catalog = [
      offer("held", "https://www.motion.example/feed.xml"),
      offer("new", "https://type.example/rss"),
    ];
    expect(freshOffers(catalog, [{ host: "motion.example" }]).map((o) => o.id)).toEqual(["new"]);
  });

  it("offers everything when there are no sources yet", () => {
    expect(freshOffers([offer("a", "https://a.example/feed")], [])).toHaveLength(1);
  });
});
