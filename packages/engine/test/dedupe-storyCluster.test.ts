import type { Item, SeenFile, Source } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { dedupe } from "../src/dedupe/dedupe.js";
import {
  clusterStories,
  isSameStory,
  modelsConflict,
  modelTokens,
  productTokens,
  STORY_CLUSTER_THRESHOLD,
  sharesModel,
  storySimilarity,
} from "../src/dedupe/storyCluster.js";
import { makeItem, makeSource } from "./fetch-helpers.js";

const emptySeen: SeenFile = { version: 1, items: {} };
const TECH = "consumer_tech_releases" as const;

/** The consumer tech outlets, all hinted, plus sources outside the beat. */
const OUTLETS = [
  "9to5google",
  "9to5mac",
  "android-authority",
  "ars-technica",
  "engadget",
  "gsmarena",
  "the-verge",
  "toms-hardware",
] as const;
const sources: Source[] = [
  ...OUTLETS.map((id) => makeSource({ id, category_hint: TECH })),
  makeSource({ id: "craft-blog", high_signal: true, category_hint: "design_engineering_craft" }),
  makeSource({ id: "plain-blog" }),
  makeSource({ id: "exa-discovery", type: "exa" }),
];

let seq = 0;
/** A headline as one outlet published it. Every item gets its own URL. */
function story(source: string, title: string, overrides: Partial<Item> = {}): Item {
  seq += 1;
  return makeItem({
    url: `https://${source}.example/story-${seq}`,
    title,
    source_id: source,
    published_at: "2026-10-05T12:00:00.000Z",
    ...overrides,
  });
}

/** Six outlets on one tablet launch. No two headlines are near duplicates. */
const tablet = (): Item[] => [
  story("the-verge", "Apple announces the iPad Pro with M5 chip, starting at $999"),
  story("9to5mac", "Apple unveils new iPad Pro with M5 chip and faster charging"),
  story("engadget", "Apple’s iPad Pro gets the M5 chip and Wi-Fi 7"),
  story("ars-technica", "M5 iPad Pro arrives with a faster GPU and the same design"),
  story("gsmarena", "Apple iPad Pro (M5) goes official with 12GB RAM base model"),
  story("toms-hardware", "Apple debuts M5 chip in new iPad Pro and 14-inch MacBook Pro"),
];

/** Five outlets on one earbuds launch. */
const earbuds = (): Item[] => [
  story(
    "the-verge",
    "Sony’s WF-1000XM6 earbuds are official, with a new chip and better noise cancellation",
  ),
  story("engadget", "Sony WF-1000XM6 review: the best noise cancelling earbuds get better"),
  story(
    "android-authority",
    "Sony WF-1000XM6 launched: price, specs, and everything you need to know",
  ),
  story("gsmarena", "Sony WF-1000XM6 unveiled with improved ANC and 8-hour battery life"),
  story("9to5google", "Sony announces WF-1000XM6 earbuds for $329"),
];

/** Two phones launched the same week with the same talking points. */
const phones = (): Item[] => [
  story("9to5google", "Google Pixel 11 launches with Tensor G6 and seven years of updates"),
  story(
    "android-authority",
    "Samsung Galaxy S27 launches with a bigger battery and seven years of updates",
  ),
];

const run = (items: Item[]) => dedupe({ items, sources, seen: emptySeen });
const tokens = (title: string): string[] => [...productTokens(title)];

describe("product tokens", () => {
  it("keeps the brand and the model and drops the launch verbs around them", () => {
    expect(tokens("Apple announces the iPad Pro with M5 chip, starting at $999")).toEqual([
      "apple",
      "ipad",
      "pro",
      "m5",
    ]);
    expect(tokens("Apple unveils new iPad Pro with M5 chip and faster charging")).toEqual([
      "apple",
      "ipad",
      "pro",
      "m5",
    ]);
  });

  it.each([
    "launches",
    "announces",
    "unveils",
    "official",
    "review",
    "hands-on",
    "leaks",
    "launched",
    "debuts",
    "arrives",
  ])("drops the filler word %s", (word) => {
    expect(tokens(`Acme Phone 7 ${word}`)).toEqual(["acme", "phone", "7"]);
  });

  it("drops 'first look' and other words about the article", () => {
    expect(tokens("First look: Acme Phone 7 rumors and everything you need to know")).toEqual([
      "acme",
      "phone",
      "7",
    ]);
  });

  it("drops prices, percentages, measurements and years, which describe a product without naming it", () => {
    expect(
      tokens("Acme Phone 7 gets a 6.3-inch 120Hz display, 5000mAh battery and 12GB RAM for €799"),
    ).toEqual(["acme", "phone", "7"]);
    expect(tokens("Acme Phone 7 is 20% lighter in 2026, at $999")).toEqual(["acme", "phone", "7"]);
    expect(tokens("Acme Watch 4 with an 8-hour battery and a 7-year promise")).toEqual([
      "acme",
      "watch",
      "4",
      "promise",
    ]);
  });

  it("removes possessives, quotes and brackets", () => {
    expect(tokens("Sony’s WF-1000XM6 earbuds")).toEqual(["sony", "wf-1000xm6", "earbuds"]);
    expect(tokens("Apple's iPad Pro (M5): “iPad” again")).toEqual(["apple", "ipad", "pro", "m5"]);
  });

  it("keeps a hyphenated model name whole and reads 'M5-powered' as the M5", () => {
    expect(tokens("Sony WF-1000XM6 and Wi-Fi 7")).toEqual(["sony", "wf-1000xm6", "wi-fi", "7"]);
    expect(tokens("An M5-powered MacBook Air")).toEqual(["m5", "macbook", "air"]);
  });

  it("finds the model tokens: anything with a digit that is left", () => {
    expect([...modelTokens(productTokens("Google Pixel 11 Pro with Tensor G6 for $999"))]).toEqual([
      "11",
      "g6",
    ]);
    expect([...modelTokens(productTokens("Apple Watch gets new faces"))]).toEqual([]);
  });
});

describe("story similarity", () => {
  const sim = (a: string, b: string): number => storySimilarity(productTokens(a), productTokens(b));
  const same = (a: string, b: string): boolean => isSameStory(productTokens(a), productTokens(b));

  it("weights model tokens double", () => {
    // Shared: apple, ipad, pro (1 each) and m5 (2). Only in one: gpu (1).
    expect(sim("Apple iPad Pro M5", "Apple iPad Pro M5 GPU")).toBeCloseTo(5 / 6, 6);
    // Shared: acme, phone (1 each). Only in one: 7 (2).
    expect(sim("Acme Phone", "Acme Phone 7")).toBeCloseTo(2 / 4, 6);
  });

  it("matches every pair of the tablet headlines to the plainest one", () => {
    const [plain, ...rest] = tablet().map((item) => item.title) as [string, ...string[]];
    for (const title of rest) expect(same(plain, title), title).toBe(true);
  });

  it("needs the shared model to match two headlines that each add their own detail", () => {
    const a = "Apple’s iPad Pro gets the M5 chip and Wi-Fi 7";
    const b = "M5 iPad Pro arrives with a faster GPU and the same design";
    expect(sim(a, b)).toBeCloseTo(4 / 9, 6);
    expect(sim(a, b)).toBeLessThan(STORY_CLUSTER_THRESHOLD);
    expect(sharesModel(productTokens(a), productTokens(b))).toBe(true);
    expect(same(a, b)).toBe(true);
  });

  it("keeps two phones apart even when their headlines share the talking points", () => {
    const [pixel, galaxy] = phones().map((item) => item.title) as [string, string];
    expect(modelsConflict(productTokens(pixel), productTokens(galaxy))).toBe(true);
    expect(sim(pixel, galaxy)).toBe(0);
    expect(same(pixel, galaxy)).toBe(false);
  });

  it.each([
    [
      "Google Pixel 11 Pro hands-on: the camera bar grows up",
      "Google Pixel 11a leaks in new renders",
    ],
    ["OnePlus 15 review: fast, flat and finally waterproof", "OnePlus 15R launch date confirmed"],
    ["Apple iPad Pro with M5 chip announced", "Apple’s new iPad Air is here with an M4 chip"],
    ["Sony WF-1000XM6 earbuds are official", "Sony WH-1000XM6 headphones get a firmware update"],
    ["Apple Watch Series 12 review", "Apple Watch Ultra 4 review"],
  ])("treats %s and %s as different products", (a, b) => {
    expect(modelsConflict(productTokens(a), productTokens(b))).toBe(true);
    expect(same(a, b)).toBe(false);
  });

  it("does not let one model name stand in for another that only contains it", () => {
    // "11" and "11a" are different tokens, so a Pixel 11 story never absorbs a Pixel 11a story.
    expect(modelsConflict(productTokens("Pixel 11"), productTokens("Pixel 11a"))).toBe(true);
    // A headline that names both devices conflicts with neither.
    const both = productTokens("Google Pixel 11 and Pixel 11a announced");
    expect(modelsConflict(both, productTokens("Pixel 11 hands-on"))).toBe(false);
    expect(modelsConflict(both, productTokens("Pixel 11a hands-on"))).toBe(false);
  });

  it("keeps two stories about one product apart when they share little else", () => {
    expect(
      same(
        "Google Pixel 11 launches with Tensor G6 and seven years of updates",
        "Pixel 11 owners report screen flicker after the first update",
      ),
    ).toBe(false);
    expect(same("Android 16 QPR2 rolls out to Pixels", "Android 16 gets a new desktop mode")).toBe(
      false,
    );
  });

  it("keeps same-brand products without model numbers apart", () => {
    expect(
      same("Tesla Model Y gets cheaper in Europe", "Tesla Model 3 gets cheaper in Europe"),
    ).toBe(false);
    expect(same("Apple Watch sales fall in China", "Apple Watch import ban upheld")).toBe(false);
    expect(same("Samsung Galaxy Unpacked date set", "Samsung Galaxy Ring 2 teased")).toBe(false);
  });

  it("scores zero for a headline with fewer than two product tokens, or a pair sharing fewer than two", () => {
    expect(sim("Apple announces", "Apple announces")).toBe(0);
    expect(sim("Apple iPad", "Apple MacBook")).toBe(0);
    expect(sim("", "Apple iPad Pro")).toBe(0);
  });

  it("is symmetric", () => {
    const titles = [...tablet(), ...earbuds(), ...phones()].map((item) => item.title);
    for (const a of titles) {
      for (const b of titles) expect(sim(a, b)).toBe(sim(b, a));
    }
  });
});

describe("story clustering in dedupe", () => {
  it("collapses six outlets on one tablet launch into one item and records the coverage", () => {
    const { items, report } = run(tablet());
    expect(items).toHaveLength(1);
    expect(report).toMatchObject({ input: 6, near_duplicate: 0, story_clustered: 5, output: 1 });
    expect(items[0]?.signals.coverage).toBe(6);
  });

  it("collapses five outlets on one earbuds launch", () => {
    const { items, report } = run(earbuds());
    expect(items).toHaveLength(1);
    expect(report.story_clustered).toBe(4);
    expect(items[0]?.signals.coverage).toBe(5);
    expect(items[0]?.title).toContain("WF-1000XM6");
  });

  it("does not merge two different phones", () => {
    const { items, report } = run(phones());
    expect(items).toHaveLength(2);
    expect(report.story_clustered).toBe(0);
    for (const item of items) expect(item.signals).not.toHaveProperty("coverage");
  });

  it("sorts a mixed pool into one tablet, one earbuds and two phones", () => {
    const pool = [...tablet(), ...earbuds(), ...phones()];
    const { items, report } = run(pool);
    expect(report).toMatchObject({ input: 13, story_clustered: 9, output: 4 });
    expect(items.map((item) => item.signals.coverage ?? 1).sort()).toEqual([1, 1, 5, 6]);
  });

  it("gives the same result whatever order the pool arrives in", () => {
    const pool = [...tablet(), ...earbuds(), ...phones()];
    const baseline = run(pool).items;
    for (const shift of [1, 4, 7, 11]) {
      const rotated = [...pool.slice(shift), ...pool.slice(0, shift)];
      expect(run(rotated).items).toEqual(baseline);
      expect(run([...rotated].reverse()).items).toEqual(baseline);
    }
  });

  it("keeps the best item by the usual quality order: source signal, then votes, then source id", () => {
    // Equal quality: the lowest source id leads, so the choice never depends on input order.
    expect(run(tablet()).items[0]?.source_id).toBe("9to5mac");

    const signalled = sources.map((source) =>
      source.id === "the-verge" ? { ...source, high_signal: true } : source,
    );
    const kept = dedupe({ items: tablet(), sources: signalled, seen: emptySeen }).items[0];
    expect(kept?.source_id).toBe("the-verge");
    expect(kept?.title).toBe("Apple announces the iPad Pro with M5 chip, starting at $999");

    const voted = tablet().map((item) =>
      item.source_id === "gsmarena" ? { ...item, signals: { hn_points: 40 } } : item,
    );
    expect(run(voted).items[0]?.source_id).toBe("gsmarena");
  });

  it("lets the kept item inherit what an absorbed one knew", () => {
    const [lead, ...rest] = tablet() as [Item, ...Item[]];
    const pool = [
      { ...lead, source_id: "9to5mac", snippet: "", author: undefined },
      ...rest
        .filter((item) => item.source_id !== "9to5mac")
        .map((item) =>
          item.source_id === "ars-technica"
            ? { ...item, snippet: "The M5 is about 20 percent faster.", author: "Ars Staff" }
            : item,
        ),
    ];
    const kept = run(pool).items[0];
    expect(kept?.source_id).toBe("9to5mac");
    expect(kept?.snippet).toBe("The M5 is about 20 percent faster.");
    expect(kept?.author).toBe("Ars Staff");
    expect(kept?.signals.coverage).toBe(5);
  });

  it("merges only across sources: two articles from one outlet both stay", () => {
    const launch = story("the-verge", "Apple announces the iPad Pro with M5 chip");
    const handsOn = story("the-verge", "iPad Pro M5 hands-on: thinner bezels");
    const { items, report } = run([launch, handsOn]);
    expect(items).toHaveLength(2);
    expect(report.story_clustered).toBe(0);
  });

  it("counts each source once, however many of its articles joined the cluster", () => {
    const pool = [
      story("9to5mac", "Apple unveils new iPad Pro with M5 chip"),
      story("the-verge", "Apple announces the iPad Pro with M5 chip"),
      story("the-verge", "iPad Pro M5 hands-on: thinner bezels"),
    ];
    const { items, report } = run(pool);
    expect(items).toHaveLength(1);
    expect(report.story_clustered).toBe(2);
    expect(items[0]?.signals.coverage).toBe(2);
  });

  it("merges inside the 72-hour window and not outside it", () => {
    const first = story("9to5mac", "Apple unveils new iPad Pro with M5 chip", {
      published_at: "2026-10-01T12:00:00.000Z",
    });
    const within = story("the-verge", "Apple announces the iPad Pro with M5 chip", {
      published_at: "2026-10-04T12:00:00.000Z",
    });
    const outside = story("engadget", "Apple’s iPad Pro gets the M5 chip", {
      published_at: "2026-10-04T12:00:01.000Z",
    });
    expect(run([first, within]).items).toHaveLength(1);
    expect(run([first, outside]).items).toHaveLength(2);
  });

  it("leaves the same headlines alone when they come from sources outside the tech beat", () => {
    const pool = [
      story("craft-blog", "Apple announces the iPad Pro with M5 chip"),
      story("plain-blog", "Apple unveils new iPad Pro with M5 chip and faster charging"),
    ];
    const { items, report } = run(pool);
    expect(items).toHaveLength(2);
    expect(report.story_clustered).toBe(0);
  });

  it("never merges a tech item with one from outside the beat", () => {
    const pool = [
      story("the-verge", "Apple announces the iPad Pro with M5 chip"),
      story("plain-blog", "Apple unveils new iPad Pro with M5 chip and faster charging"),
    ];
    expect(run(pool).items).toHaveLength(2);
  });

  it("clusters a discovery result that carries the tech hint of its query", () => {
    const hinted = story("exa-discovery", "Apple iPad Pro M5 launch: what changed", {
      source_type: "exa",
      category_hint: TECH,
    });
    const unhinted = story("exa-discovery", "Apple iPad Pro M5 launch: a design teardown", {
      source_type: "exa",
    });
    const outlet = story("the-verge", "Apple announces the iPad Pro with M5 chip");
    const { items, report } = run([hinted, unhinted, outlet]);
    expect(report.story_clustered).toBe(1);
    expect(items.map((item) => item.id).sort()).toEqual([unhinted.id, hinted.id].sort());
    expect(items.find((item) => item.id === hinted.id)?.signals.coverage).toBe(2);
  });

  it("counts an outlet the near-duplicate pass already merged", () => {
    // The first two headlines are near duplicates (the same wire copy); the third is not.
    const pool = [
      story("9to5mac", "Apple unveils new iPad Pro with M5 chip and faster charging today"),
      story("engadget", "Apple unveils new iPad Pro with M5 chip and faster charging"),
      story("ars-technica", "M5 iPad Pro arrives with a faster GPU and the same design"),
    ];
    const { items, report } = run(pool);
    expect(report).toMatchObject({ near_duplicate: 1, story_clustered: 1, output: 1 });
    expect(items[0]?.signals.coverage).toBe(3);
  });

  it("records coverage for a near-duplicate pair even when no other headline joins", () => {
    const pool = [
      story("9to5mac", "Apple unveils new iPad Pro with M5 chip and faster charging today"),
      story("engadget", "Apple unveils new iPad Pro with M5 chip and faster charging"),
    ];
    const { items, report } = run(pool);
    expect(report).toMatchObject({ near_duplicate: 1, story_clustered: 0, output: 1 });
    expect(items[0]?.signals.coverage).toBe(2);
  });

  it("keeps a tech article in the beat when the copy a discovery search found is the one kept", () => {
    // The same URL from The Verge and from an unhinted Exa query. The Exa copy has the votes, so
    // it survives the same-URL pass; it must still cluster with the other outlets.
    const [lead, ...rest] = tablet() as [Item, ...Item[]];
    const sameUrl: Item = {
      ...lead,
      source_id: "exa-discovery",
      source_type: "exa",
      signals: { hn_points: 150 },
    };
    const { items, report } = run([lead, sameUrl, ...rest]);
    expect(report).toMatchObject({ same_url: 1, story_clustered: 5, output: 1 });
    expect(items[0]?.source_id).toBe("exa-discovery");
    expect(items[0]?.category_hint).toBe(TECH);
    expect(items[0]?.signals).toMatchObject({ hn_points: 150, coverage: 6 });
  });

  it("does not hand a hint to an item whose own source already has one", () => {
    const fromCraft = story("craft-blog", "A drawer that keeps its velocity");
    const sameUrl: Item = { ...fromCraft, source_id: "the-verge" };
    const kept = run([fromCraft, sameUrl]).items[0];
    expect(kept?.source_id).toBe("craft-blog");
    expect(kept).not.toHaveProperty("category_hint");
  });

  it("adds no hint and no coverage to items that were never merged", () => {
    const { items } = run([story("the-verge", "Acme Phone 7 launches"), ...phones()]);
    for (const item of items) {
      expect(item).not.toHaveProperty("category_hint");
      expect(item.signals).not.toHaveProperty("coverage");
    }
  });
});

describe("clusterStories", () => {
  const byId = (a: Item, b: Item): number => a.id.localeCompare(b.id);
  const keepFirst = (keep: Item): Item => keep;

  it("compares against the cluster leader only, so a vague headline cannot chain two products", () => {
    // B resembles A and C resembles B, but A and C name different models.
    const a = story("the-verge", "Acme Phone 7 launches", { id: "aaaaaaaaaaaa" });
    const b = story("engadget", "Acme Phone launches", { id: "bbbbbbbbbbbb" });
    const c = story("gsmarena", "Acme Phone 7a launches", { id: "cccccccccccc" });
    const pair = (x: Item, y: Item): boolean =>
      isSameStory(productTokens(x.title), productTokens(y.title));
    expect([pair(a, b), pair(b, c), pair(a, c)]).toEqual([true, true, false]);

    const result = clusterStories({
      items: [c, b, a],
      eligible: () => true,
      compare: byId,
      absorb: keepFirst,
    });
    expect(result.merged).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["cccccccccccc", "aaaaaaaaaaaa"]);
    expect(result.items.find((item) => item.id === a.id)?.signals.coverage).toBe(2);
    expect(result.items.find((item) => item.id === c.id)?.signals).not.toHaveProperty("coverage");
  });

  it("returns survivors in input order and passes ineligible items through untouched", () => {
    const outside = story("plain-blog", "Acme Phone 7 launches", { id: "111111111111" });
    const lead = story("the-verge", "Acme Phone 7 launches", { id: "222222222222" });
    const twin = story("engadget", "Acme Phone 7 unveiled", { id: "333333333333" });
    const result = clusterStories({
      items: [twin, outside, lead],
      eligible: (item) => item.source_id !== "plain-blog",
      compare: byId,
      absorb: keepFirst,
    });
    expect(result.items.map((item) => item.id)).toEqual(["111111111111", "222222222222"]);
    expect(result.items[0]).toBe(outside);
    expect(result.merged).toBe(1);
  });

  it("honours a custom threshold and window", () => {
    const lead = story("the-verge", "Acme Phone launches", { id: "222222222222" });
    const twin = story("engadget", "Acme Phone 7 unveiled", { id: "333333333333" });
    const base = { eligible: () => true, compare: byId, absorb: keepFirst };
    // Similarity 0.5: in at the default, out at 0.6.
    expect(clusterStories({ ...base, items: [lead, twin] }).merged).toBe(1);
    expect(clusterStories({ ...base, items: [lead, twin], threshold: 0.6 }).merged).toBe(0);
    const later = { ...twin, published_at: "2026-10-06T12:00:00.000Z" };
    expect(clusterStories({ ...base, items: [lead, later] }).merged).toBe(1);
    expect(clusterStories({ ...base, items: [lead, later], windowHours: 12 }).merged).toBe(0);
  });

  it("changes nothing when there is nothing to cluster", () => {
    const items = [story("the-verge", "Acme Phone 7 launches")];
    const result = clusterStories({
      items,
      eligible: () => true,
      compare: byId,
      absorb: keepFirst,
    });
    expect(result).toEqual({ items, merged: 0 });
    expect(
      clusterStories({ items: [], eligible: () => true, compare: byId, absorb: keepFirst }),
    ).toEqual({ items: [], merged: 0 });
  });
});
