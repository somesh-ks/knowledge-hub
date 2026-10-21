import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_SECTIONS,
  CATEGORIES,
  ConfigOp,
  Digest,
  type Digest as DigestType,
  digestSections,
  hasOwnAllowance,
  homeSection,
  homeSectionFor,
  itemId,
  Preferences,
  parseDigestFile,
  resolveTopics,
  SECTION_TITLES,
  SECTIONS,
  seedTopicsFile,
  serializeDigestFile,
  TopicsFile,
  topicIdFromName,
} from "./index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const preferences = Preferences.parse(
  // A frozen copy, so a weight saved in Settings does not move these expectations.
  JSON.parse(
    readFileSync(join(REPO_ROOT, "packages/engine/test/fixtures/config/preferences.json"), "utf8"),
  ),
);

function customTopics(): TopicsFile {
  const seed = seedTopicsFile(preferences.weights);
  return TopicsFile.parse({
    ...seed,
    sections: [...seed.sections, { id: "quantum", title: "Quantum computing", order: 7 }],
    topics: [
      ...seed.topics,
      {
        id: "quantum_computing",
        name: "Quantum computing",
        description: "Hardware, algorithms and error correction.",
        weight: 0.7,
        enabled: true,
        keywords: ["qubit"],
        section_id: "quantum",
        never_publish: false,
        origin: "custom",
        depth: "fit_only",
      },
    ],
  });
}

describe("config/topics.json", () => {
  const file = TopicsFile.parse(
    JSON.parse(readFileSync(join(REPO_ROOT, "config", "topics.json"), "utf8")),
  );

  it("resolves to every shipped topic, whatever the owner has renamed or added in the app", () => {
    const resolved = resolveTopics(file, preferences);
    const ids = new Set(resolved.topics.map((topic) => topic.id));
    for (const topic of seedTopicsFile(preferences.weights).topics) expect(ids).toContain(topic.id);
    expect(TopicsFile.safeParse(resolved).success).toBe(true);
  });

  it("names every category with today's section, then the app's topics", () => {
    // The owner adds topics and sets weights from Settings, and the general news topics ship with the
    // app, so only the built-in and app topics and their sections are pinned; anything else is
    // general or the owner's own.
    expect(file.topics.filter((t) => t.origin === "builtin").map((t) => t.id)).toEqual([
      ...CATEGORIES,
    ]);
    for (const topic of file.topics.filter((t) => t.origin !== "builtin" && t.origin !== "app"))
      expect(["general", "custom"]).toContain(topic.origin);
    expect(file.topics.filter((topic) => topic.origin === "app").map((t) => t.id)).toEqual([
      "design",
      "trending",
    ]);
    for (const topic of file.topics.filter((t) => t.origin === "builtin")) {
      const home = homeSection(topic.id as (typeof CATEGORIES)[number], "rss");
      if (home !== null) expect(topic.section_id).toBe(home);
    }
  });

  it("lists today's sections with their titles in digest order", () => {
    expect(file.sections.map((s) => s.id)).toEqual([...SECTIONS]);
    expect(file.sections.map((s) => s.title)).toEqual(SECTIONS.map((id) => SECTION_TITLES[id]));
    expect(file.sections).toEqual(BUILTIN_SECTIONS);
  });
});

describe("TopicsFile", () => {
  it("rejects a topic in a section that does not exist", () => {
    const seed = seedTopicsFile(preferences.weights);
    const bad = {
      ...seed,
      topics: [...seed.topics, { ...customTopics().topics.at(-1), section_id: "missing" }],
    };
    expect(TopicsFile.safeParse(bad).success).toBe(false);
  });

  it("rejects a custom topic that takes a built-in id or a reserved word", () => {
    const base = customTopics();
    const last = base.topics.at(-1);
    for (const id of ["design_engineering_craft", "none", "watch"]) {
      const bad = { ...base, topics: [...base.topics.slice(0, -1), { ...last, id }] };
      expect(TopicsFile.safeParse(bad).success, id).toBe(false);
    }
  });

  it("takes built-in weights from the preferences, whatever the file says", () => {
    const stale = seedTopicsFile({ ...preferences.weights, design_engineering_craft: 0.1 });
    const resolved = resolveTopics(stale, preferences);
    expect(resolved.topics.find((t) => t.id === "design_engineering_craft")?.weight).toBe(
      preferences.weights.design_engineering_craft,
    );
  });

  it("snaps a stored weight to its stop, and a topic at Off never publishes", () => {
    const stored = { ...preferences, weights: { ...preferences.weights } };
    stored.weights.css_canvas_motion_techniques = 0.88;
    stored.weights.venture_capital_and_gossip = 0.1;
    const byId = new Map(resolveTopics(null, stored).topics.map((t) => [t.id, t]));
    expect(byId.get("css_canvas_motion_techniques")?.weight).toBe(0.85);
    expect(byId.get("css_canvas_motion_techniques")?.never_publish).toBe(false);
    expect(byId.get("venture_capital_and_gossip")).toMatchObject({
      weight: 0,
      never_publish: true,
    });
  });

  it("restores built-in topics and sections a file leaves out, and reads a missing file as the seed", () => {
    expect(resolveTopics(null, preferences)).toEqual(seedTopicsFile(preferences.weights));
    const trimmed = { ...customTopics(), topics: customTopics().topics.slice(3) };
    expect(resolveTopics(trimmed, preferences).topics.map((t) => t.id)).toEqual(
      expect.arrayContaining([...CATEGORIES, "quantum_computing"]),
    );
  });
});

describe("home sections", () => {
  it("keeps every built-in category where it has always been, topics file or not", () => {
    for (const category of CATEGORIES) {
      expect(homeSectionFor(null, category, "rss")).toBe(homeSection(category, "rss"));
      // A video goes where its topic goes.
      expect(homeSectionFor(customTopics(), category, "youtube")).toBe(
        homeSection(category, "youtube"),
      );
    }
  });

  it("places a custom topic by its section, and nothing for an unknown or never-publish id", () => {
    expect(homeSectionFor(customTopics(), "quantum_computing", "rss")).toBe("quantum");
    expect(homeSectionFor(customTopics(), "removed_topic", "rss")).toBeNull();
    expect(homeSectionFor(null, "quantum_computing", "rss")).toBeNull();
  });

  it("gives Tech and custom sections their own allowance, and no other built-in section", () => {
    expect(hasOwnAllowance("tech")).toBe(true);
    expect(hasOwnAllowance("quantum")).toBe(true);
    expect(hasOwnAllowance("trending")).toBe(true);
    for (const id of ["top", "design", "ui-craft", "ai", "research", "launches", "watch"]) {
      expect(hasOwnAllowance(id)).toBe(false);
    }
  });

  it("derives an id from a name", () => {
    expect(topicIdFromName("Quantum computing")).toBe("quantum_computing");
    expect(topicIdFromName("  Café & Bar! ")).toBe("cafe_bar");
    expect(topicIdFromName("!!!")).toBe("topic");
  });
});

function digestWith(sections: readonly string[], extra: Partial<DigestType> = {}): DigestType {
  return Digest.parse({
    id: "2026-10-08",
    date: "2026-10-08",
    kind: "regular",
    verified: false,
    generated_at: "2026-10-08T05:13:00.000Z",
    window: { from: "2026-10-06T05:13:00.000Z", to: "2026-10-08T05:13:00.000Z" },
    read_minutes: 2,
    listen_minutes: 3,
    audio: null,
    cover: { template: "spring", palette: "dusk", seed: 1 },
    items: sections.map((section, n) => ({
      id: itemId(`https://example.com/${section}/${n}`),
      section,
      category: section === "quantum" ? "quantum_computing" : "design_engineering_craft",
      source_type: "rss",
      headline: `Headline ${n}`,
      url: `https://example.com/${section}/${n}`,
      source: "Example",
      summary: "A short summary.",
      score: 0.8,
    })),
    ...extra,
  });
}

describe("digest sections", () => {
  it("parses an item in a custom section and category", () => {
    const digest = digestWith(["top", "ui-craft", "quantum"]);
    expect(digest.items[2]).toMatchObject({ section: "quantum", category: "quantum_computing" });
  });

  it("rejects a section or category that is not a lowercase id", () => {
    expect(() => digestWith(["Quantum Computing", "top", "ui-craft"])).toThrow();
  });

  it("orders built-in sections by the built-in table when there is no snapshot", () => {
    const digest = digestWith(["watch", "ai", "top", "tech", "trending", "research"]);
    expect(digestSections(digest)).toEqual([
      { id: "top", title: "Top picks" },
      { id: "ai", title: "AI Products" },
      { id: "tech", title: "Tech Product Launches" },
      { id: "trending", title: "Trending" },
      // Retired sections keep their old titles so a published briefing renders as it did.
      { id: "research", title: "Research" },
      { id: "watch", title: "Watch and listen" },
    ]);
  });

  it("reads titles and order from the snapshot, so a removed topic cannot break an old briefing", () => {
    const digest = digestWith(["top", "ui-craft", "quantum"], {
      section_titles: { top: "Top picks", "ui-craft": "Interaction craft", quantum: "Quantum" },
    });
    expect(digestSections(digest)).toEqual([
      { id: "top", title: "Top picks" },
      { id: "ui-craft", title: "Interaction craft" },
      { id: "quantum", title: "Quantum" },
    ]);
  });

  it("falls back to the id for a custom section with no snapshot, and to the table for an omitted built-in", () => {
    const digest = digestWith(["top", "ui-craft", "quantum"], {
      section_titles: { quantum: "Quantum" },
    });
    expect(digestSections(digest).map((s) => s.title)).toEqual([
      "Quantum",
      "Top picks",
      "Design Engineering",
    ]);
    const bare = digestWith(["top", "ui-craft", "quantum"]);
    expect(digestSections(bare).at(-1)).toEqual({ id: "quantum", title: "quantum" });
  });

  it("round-trips section_titles through the file and shows them in the body", () => {
    const digest = digestWith(["top", "ui-craft", "quantum"], {
      section_titles: { top: "Top picks", "ui-craft": "Interaction craft", quantum: "Quantum" },
    });
    const text = serializeDigestFile(digest);
    expect(text).toContain("section_titles:");
    expect(text).toContain("## Quantum");
    expect(parseDigestFile(text)).toEqual(digest);
  });

  it.each(["2026-10-06", "2026-10-07"])(
    "keeps the committed digest %s parsing with its built-in sections",
    (id) => {
      const digest = parseDigestFile(
        readFileSync(join(REPO_ROOT, "packages/engine/test/fixtures/digests", `${id}.md`), "utf8"),
      );
      expect(digest.section_titles).toBeUndefined();
      const ids = digestSections(digest).map((section) => section.id);
      expect(ids.length).toBeGreaterThan(0);
      for (const section of digestSections(digest)) {
        expect(section.title).toBe(SECTION_TITLES[section.id as (typeof SECTIONS)[number]]);
      }
      // Serializing what was parsed adds nothing: no snapshot appears for a built-in-only digest.
      expect(serializeDigestFile(digest)).not.toContain("section_titles");
    },
  );
});

describe("ConfigOp", () => {
  it("accepts each op", () => {
    const ops = [
      { op: "topic.upsert", topic: { name: "Quantum", description: "Qubits." } },
      { op: "topic.remove", id: "quantum" },
      { op: "source.add", url: "https://example.com/blog", topic_ids: ["quantum"] },
      { op: "source.set", id: "blog", enabled: false },
      { op: "source.remove", id: "blog" },
      { op: "weights.set", weights: { quantum: 0.5 } },
    ];
    for (const op of ops) expect(ConfigOp.safeParse(op).success, op.op).toBe(true);
  });

  it("fills defaults for a minimal topic", () => {
    const parsed = ConfigOp.parse({
      op: "topic.upsert",
      topic: { name: "Quantum", description: "Qubits." },
    });
    expect(parsed).toMatchObject({
      topic: { weight: 0.7, enabled: true, keywords: [], never_publish: false, depth: "fit_only" },
    });
  });

  it("rejects unknown ops, empty changes, out-of-range weights and non-http URLs", () => {
    const bad = [
      { op: "topic.explode" },
      { op: "source.set", id: "blog" },
      { op: "weights.set", weights: {} },
      { op: "weights.set", weights: { quantum: 1.5 } },
      { op: "source.add", url: "ftp://example.com/feed" },
      { op: "source.add", url: "not a url" },
      { op: "topic.remove", id: "Has Capitals" },
    ];
    for (const op of bad) expect(ConfigOp.safeParse(op).success, JSON.stringify(op)).toBe(false);
  });
});
