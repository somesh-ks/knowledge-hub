import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CatalogSource,
  cadenceLabel,
  catalogHost,
  catalogLine,
  catalogWords,
  freshOffers,
  loadSourceCatalog,
  parseSourceCatalog,
  suggestSources,
  topicTerms,
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
        url: "https://www.nngroup.com/",
        feed_url: "https://www.nngroup.com/feed/rss/",
        about: "UX research articles and usability guidance",
        cadence: "several a week",
        tags: ["design", "ux", "research"],
      },
    ]);
  });

  it("keeps the site's page when it is a web address, and no page when it is not", () => {
    const found = parseSourceCatalog({
      sources: [
        entry({ id: "page-ok" }),
        entry({ id: "page-ftp", url: "ftp://example.com" }),
        entry({ id: "page-none", url: undefined }),
      ],
    });
    expect(found.map((source) => source.url)).toEqual(["https://www.nngroup.com/", null, null]);
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

describe("catalogHost", () => {
  it("names the site by its own page, else by its feed, without www", () => {
    expect(
      catalogHost({
        url: "https://www.macrumors.com/",
        feed_url: "https://feeds.macrumors.com/All",
      }),
    ).toBe("macrumors.com");
    expect(catalogHost({ url: null, feed_url: "https://www.example.com/feed" })).toBe(
      "example.com",
    );
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
    url: null,
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

describe("catalogWords", () => {
  it("lowercases, and folds a plural, a -ies and an -ing ending into the word", () => {
    expect(catalogWords("Phones, STORIES, Learning, boxes and classes")).toEqual([
      "phone",
      "story",
      "learn",
      "box",
      "class",
    ]);
    expect(catalogWords("movie movies")).toEqual(["movy", "movy"]);
  });

  it("leaves a short word as it is, so a tag like ios, css or ai is itself", () => {
    expect(catalogWords("iOS CSS AI gps")).toEqual(["ios", "css", "ai", "gps"]);
  });

  it("drops stop words, the words every topic says of its news, numbers and single letters", () => {
    expect(catalogWords("The news of 2026 in a box, and the launches and releases")).toEqual([
      "box",
    ]);
    expect(catalogWords("")).toEqual([]);
  });

  it("says the words in the order they came, and splits on anything that is not a letter or digit", () => {
    expect(catalogWords("UI/UX, web-design; caf\u00e9")).toEqual([
      "ui",
      "ux",
      "web",
      "design",
      "caf\u00e9",
    ]);
  });
});

describe("topicTerms", () => {
  const terms = (topic: Parameters<typeof topicTerms>[0]) => [...topicTerms(topic)].sort();

  it("holds the words of the name, the id, the keywords and the description, each once", () => {
    expect(
      terms({
        id: "motion-design",
        name: "Motion design",
        description: "Animation in interfaces.",
        keywords: ["transitions", "Motion"],
      }),
    ).toEqual(["animation", "design", "interface", "motion", "transition"]);
  });

  it("adds what an alias says: tech is technology, and ai is machine learning and llm", () => {
    expect(terms({ name: "Tech" })).toEqual(["tech", "technology"]);
    expect(terms({ name: "Technology" })).toEqual(["tech", "technology"]);
    expect(terms({ name: "AI" })).toEqual([
      "ai",
      "artificial",
      "intelligence",
      "learn",
      "llm",
      "machine",
    ]);
    expect(terms({ name: "Machine learning" })).toEqual(["ai", "learn", "machine"]);
    expect(terms({ name: "Learning machines" })).toEqual(["learn", "machine"]);
  });

  it("makes ui and ux look for interface and interaction, and not the other way", () => {
    expect(terms({ name: "UX" })).toEqual(["interaction", "interface", "ux"]);
    expect(terms({ name: "UI" })).toEqual(["interaction", "interface", "ui"]);
    expect(terms({ name: "Interaction patterns" })).toEqual(["interaction", "pattern"]);
  });

  it("does not read what a description says the topic is not", () => {
    expect(
      terms({
        name: "Culture",
        description: "Film and music. Not sports results. Books; excluding podcasts.",
      }),
    ).toEqual(["book", "culture", "film", "music"]);
  });

  it("has no words for a topic that has none to give", () => {
    expect(terms({ name: "Other", description: "" })).toEqual([]);
  });
});

describe("suggestSources", () => {
  const source = (
    id: string,
    tags: string[],
    extra: Partial<CatalogSource> = {},
  ): CatalogSource => ({
    id,
    name: id,
    url: `https://${id}.example/`,
    feed_url: `https://${id}.example/feed`,
    about: "",
    cadence: null,
    tags,
    ...extra,
  });
  const ids = (found: CatalogSource[]) => found.map((entry) => entry.id);

  it("scores 3 for a tag, 1 for the description and 1 for the name, per word of the topic", () => {
    const catalog = [
      source("plain", ["design"]),
      source("described", ["design"], { about: "Essays on design" }),
      source("named", ["design"], { name: "Design Desk" }),
      source("both", ["design"], { name: "Design Weekly", about: "Design essays" }),
      source("two-tags", ["design", "motion"]),
    ];
    // two-tags: 6, both: 5, then described and named (4) in the catalogue's order, then plain: 3.
    expect(ids(suggestSources(catalog, [], { name: "Motion design" }))).toEqual([
      "two-tags",
      "both",
      "described",
      "named",
      "plain",
    ]);
  });

  it("keeps the catalogue's order among equal scores", () => {
    const catalog = ["c", "a", "b"].map((id) => source(id, ["design"]));
    expect(ids(suggestSources(catalog, [], { name: "Design" }))).toEqual(["c", "a", "b"]);
  });

  it("offers only a feed that shares a tag, however its description or name reads", () => {
    const catalog = [
      source("blurb", ["phones"], { about: "Design essays", name: "Design Weekly" }),
      source("tagged", ["design"]),
    ];
    expect(ids(suggestSources(catalog, [], { name: "Design" }))).toEqual(["tagged"]);
  });

  it("meets a tag on its stem and on an alias", () => {
    const catalog = [
      source("tech", ["technology"]),
      source("models", ["llm"]),
      source("phones", ["phones"]),
    ];
    expect(ids(suggestSources(catalog, [], { name: "Tech" }))).toEqual(["tech"]);
    expect(ids(suggestSources(catalog, [], { name: "AI" }))).toEqual(["models"]);
    expect(ids(suggestSources(catalog, [], { name: "Phone" }))).toEqual(["phones"]);
  });

  it("goes by the description, the keywords and the id as well as the name", () => {
    const catalog = [source("headsets", ["headset"]), source("audio", ["audio"])];
    const topic = { id: "spatial", name: "Spatial computing", description: "Headsets and apps." };
    expect(ids(suggestSources(catalog, [], topic))).toEqual(["headsets"]);
    expect(ids(suggestSources(catalog, [], { ...topic, keywords: ["audio"] }))).toEqual([
      "headsets",
      "audio",
    ]);
    expect(ids(suggestSources(catalog, [], { id: "audio_notes", name: "Notes" }))).toEqual([
      "audio",
    ]);
  });

  it("does not offer a feed for what a description says the topic is not", () => {
    const catalog = [source("sports", ["sports"]), source("film", ["film"])];
    const topic = { name: "Culture", description: "Film and music. Not sports results." };
    expect(ids(suggestSources(catalog, [], topic))).toEqual(["film"]);
  });

  it("leaves out a source already held, by its site with or without www", () => {
    const catalog = [
      source("held", ["design"], { feed_url: "https://www.held.example/feed" }),
      source("new", ["design"]),
    ];
    expect(ids(suggestSources(catalog, [{ host: "held.example" }], { name: "Design" }))).toEqual([
      "new",
    ]);
  });

  it("leaves out a feed at an address already held, whatever its scheme, www or closing slash", () => {
    const catalog = [
      source("feed", ["design"], { feed_url: "https://feeds.example/design/" }),
      source("page", ["design"], { feed_url: "https://other.example/rss" }),
      source("new", ["design"]),
    ];
    const held = [
      { host: "elsewhere.example", feed_url: "http://www.feeds.example/design" },
      { host: "page.example", url: "https://OTHER.example/rss/" },
    ];
    expect(ids(suggestSources(catalog, held, { name: "Design" }))).toEqual(["new"]);
  });

  it("gives at most five by default, as many as asked, and none for none", () => {
    const catalog = Array.from({ length: 8 }, (_, n) => source(`s${n}`, ["design"]));
    expect(suggestSources(catalog, [], { name: "Design" })).toHaveLength(5);
    expect(suggestSources(catalog, [], { name: "Design" }, 2)).toHaveLength(2);
    expect(suggestSources(catalog, [], { name: "Design" }, 20)).toHaveLength(8);
    expect(suggestSources(catalog, [], { name: "Design" }, 0)).toEqual([]);
  });

  it("gives nothing when nothing fits, never other sources to fill the room", () => {
    const catalog = [source("a", ["design"]), source("b", ["phones"])];
    expect(suggestSources(catalog, [], { name: "Gardening", description: "Soil." })).toEqual([]);
    expect(suggestSources(catalog, [], { name: "Other" })).toEqual([]);
    expect(suggestSources([], [], { name: "Design" })).toEqual([]);
    // Everything that fits is already held.
    expect(suggestSources(catalog, [{ host: "a.example" }], { name: "Design" })).toEqual([]);
  });
});

describe("one ranking for the build and the browser", () => {
  it("is the same function, from a module the browser can load", async () => {
    const browser = await import("./sourceCatalogMatch");
    expect(browser.suggestSources).toBe(suggestSources);
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(new URL("./sourceCatalogMatch.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/from "node:/);
  });
});
