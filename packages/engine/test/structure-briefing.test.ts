import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Category,
  DEFAULT_SCHEDULE,
  defaultStructure,
  digestSections,
  homeSection,
  parseDigestFile,
  type StructureBlockInput,
  StructureBlocks,
  serializeDigestFile,
} from "@singularity/core";
import { describe, expect, it } from "vitest";
import { buildSpokenText } from "../src/audio/spokenText.js";
import { fitToBudget } from "../src/podcast/fit.js";
import { scriptSystemPrompt, scriptUserMessage } from "../src/podcast/prompt.js";
import { fitStories, shapeStories } from "../src/podcast/structure.js";
import type { PodcastStory } from "../src/podcast/types.js";
import { RELEASE_CATEGORY } from "../src/score/releaseNotes.js";
import { loadSectionPlan, sectionPlanFor } from "../src/score/sectionPlan.js";
import { GENERAL_ALLOWANCE, selectItems } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { REQUEST } from "./podcast-fixtures.js";
import { buildFixtureDigest } from "./render-factories.js";
import { makeEntry, makeItem } from "./score-factories.js";

const blocks = (input: StructureBlockInput[]) => StructureBlocks.parse(input);

describe("a Regenerate's asked length sizes its sections", () => {
  // A Regenerate at 15 minutes on the 5-minute daily was held to the daily's section counts and wrote
  // about a third of the stories its length called for (independent review, PR 391).
  it("gives a run asked for 15 minutes the 15-minute counts, and the schedule's length without one", async () => {
    const root = await mkdtemp(join(tmpdir(), "section-plan-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config/structure.json"),
      JSON.stringify({ version: 1, profile: "designer" }),
    );
    const usual = await loadSectionPlan(root, "regular");
    const asked = await loadSectionPlan(root, "regular", 15);
    expect(asked.limit("design")).toBeGreaterThan(usual.limit("design") ?? 0);
    expect(asked.limit("ai")).toBeGreaterThan(usual.limit("ai") ?? 0);
  });
});

describe("a ticked general topic airs under a profile's structure", () => {
  // The 2026-10-29 daily ticked World, Business and Science, but the Designer profile lists none of
  // them: 36 of its 53 qualifying stories were dropped as not_in_structure and it aired 3.8 of 5 minutes.
  it("adds a section for each general topic the podcast has ticked, and none for one it skips", async () => {
    const root = await mkdtemp(join(tmpdir(), "section-plan-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config/structure.json"),
      JSON.stringify({ version: 1, profile: "designer" }),
    );
    await writeFile(
      join(root, "config/schedule.json"),
      JSON.stringify({
        ...DEFAULT_SCHEDULE,
        skip_topics: ["sports", "culture"],
        weekly: { ...DEFAULT_SCHEDULE.weekly, skip_topics: ["business", "sports"] },
        general_scoped: true,
      }),
    );
    const daily = await loadSectionPlan(root, "regular");
    expect(["world", "business", "science"].map((id) => daily.includes(id))).toEqual([
      true,
      true,
      true,
    ]);
    expect(["sports", "culture"].map((id) => daily.includes(id))).toEqual([false, false]);
    const weekly = await loadSectionPlan(root, "weekly");
    expect(["world", "science", "culture"].map((id) => weekly.includes(id))).toEqual([
      true,
      true,
      true,
    ]);
    expect(["business", "sports"].map((id) => weekly.includes(id))).toEqual([false, false]);
  });

  // With the sections back the 2026-10-29 dry run still selected 11 of 52 qualifying stories: 30
  // went to the 2-story allowance of each general section, though the length wanted about 15.
  it("lets an added section hold more than the flat allowance, and more in a longer episode", async () => {
    const root = await mkdtemp(join(tmpdir(), "section-plan-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config/structure.json"),
      JSON.stringify({ version: 1, profile: "designer" }),
    );
    await writeFile(
      join(root, "config/schedule.json"),
      JSON.stringify({ ...DEFAULT_SCHEDULE, skip_topics: [], general_scoped: true }),
    );
    const short = await loadSectionPlan(root, "regular", 5);
    const long = await loadSectionPlan(root, "regular", 15);
    expect(short.limit("world") ?? 0).toBeGreaterThan(GENERAL_ALLOWANCE);
    expect(long.limit("world") ?? 0).toBeGreaterThan(short.limit("world") ?? 0);
  });
});

describe("a briefing follows its stored structure (D170)", () => {
  it("reads sections in the owner's order on the page and in the narration, after the file is written and read back", () => {
    // Without the snapshot, digestSections falls back to the built-in order and the edit is lost.
    const plan = sectionPlanFor(
      blocks([
        { type: "hello" },
        { type: "rundown", stories: 2 },
        { type: "top_picks", stories: 2 },
        { type: "section", id: "ai" },
        { type: "section", id: "design" },
        { type: "section", id: "ui-craft" },
        { type: "sign_off" },
      ]),
    );
    const { digest } = buildFixtureDigest(12, { plan });
    const reread = parseDigestFile(serializeDigestFile(digest));
    const order = digestSections(reread).map((section) => section.id);
    expect(order).toEqual(["top", "ai", "design", "ui-craft"]);
    expect(reread.items.filter((item) => item.section === "top")).toHaveLength(2);
    expect(buildSpokenText(reread).sectionStarts.map((start) => start.slug)).toEqual(order);
  });

  it("names its first stories by their chapters after the opening when the structure has a rundown, and a briefing without one has none", () => {
    const plan = sectionPlanFor(
      blocks([
        { type: "hello" },
        { type: "rundown", stories: 2 },
        { type: "top_picks" },
        { type: "section", id: "ai" },
        { type: "sign_off" },
      ]),
    );
    const labelled = (digest: ReturnType<typeof buildFixtureDigest>["digest"]) =>
      parseDigestFile(
        serializeDigestFile({
          ...digest,
          items: digest.items.map((item, index) => ({
            ...item,
            chapter: `Story ${["one", "two", "three"][index] ?? "more"}`,
          })),
        }),
      );
    const opening = (text: string) => text.split("\n\n")[0];
    expect(opening(buildSpokenText(labelled(buildFixtureDigest(8, { plan }).digest)).text)).toMatch(
      /Coming up: Story one and Story two\.$/,
    );
    expect(opening(buildSpokenText(labelled(buildFixtureDigest(8).digest)).text)).not.toMatch(
      /Coming up/,
    );
  });

  it("a saved structure equal to the defaults writes the same briefing as no structure", () => {
    const plain = buildFixtureDigest(12).digest;
    const saved = buildFixtureDigest(12, {
      plan: sectionPlanFor(defaultStructure("daily")),
    }).digest;
    expect(serializeDigestFile(saved)).toBe(serializeDigestFile(plain));
  });
});

it("a structure of Top picks and release news alone still airs both, though it lists no section", () => {
  // Release stories and Top picks are filed away from their home section, so a left-out home
  // dropped them all before they could be filed (review of #254).
  let seq = 0;
  const scored = (category: Category, score: number, title = "A story"): ScoredItem => {
    seq += 1;
    const item = makeItem({ id: seq.toString(16).padStart(12, "0"), title });
    const entry = makeEntry(item, { category });
    const breakdown = { taste: score, craftFactor: 1, penaltyFactor: 1, bonus: 0 };
    return { item, entry, score, topCategory: category, breakdown };
  };
  const plan = sectionPlanFor(
    blocks([
      { type: "hello" },
      { type: "top_picks" },
      { type: "release_news" },
      { type: "sign_off" },
    ]),
  );
  const result = selectItems({
    scored: [
      scored("design_engineering_craft", 0.9),
      scored("frontier_model_releases", 0.85),
      scored("ai_ux_interaction_patterns", 0.8),
      scored("css_canvas_motion_techniques", 0.75),
      scored("developer_tool_launches", 0.7, "Astro 6.0 ships a new router"),
    ],
    kind: "regular",
    floor: 1,
    cap: 12,
    plan,
  });
  expect(result.selected.map((selected) => selected.section)).toEqual([
    "top",
    "top",
    "top",
    "launches",
  ]);
});

// 2026-10-29 dry run: the Designer profile's counts, scaled to 5 minutes, summed to 13, so selection
// stopped at 13 with no spare for a story lost in writing and the daily aired 11 of about 15. The
// owner's rule is that the settings length is the only size limit (#147, D216): counts are the
// proportions between sections, and room left over after them goes to the best remaining stories.
describe("a block's count is a proportion, not a ceiling, when the length wants more", () => {
  const scoredIn = (category: Category, score: number, n: number): ScoredItem => {
    const item = makeItem({
      id: n.toString(16).padStart(12, "0"),
      title: `Distinct story number ${n} ${category}`,
    });
    const entry = makeEntry(item, { category });
    const breakdown = { taste: score, craftFactor: 1, penaltyFactor: 1, bonus: 0 };
    return { item, entry, score, topCategory: category, breakdown };
  };
  const home = homeSection("design_engineering_craft") ?? "design";
  const plan = sectionPlanFor(
    blocks([
      { type: "hello" },
      { type: "section", id: home, max_stories: 2 },
      { type: "sign_off" },
    ]),
  );
  const scored = Array.from({ length: 6 }, (_, n) =>
    scoredIn("design_engineering_craft", 0.9 - n * 0.01, n + 1),
  );

  it("takes more than the count when the length leaves room, and no more than the room", () => {
    const wide = selectItems({ scored, kind: "regular", floor: 1, cap: 12, total: 5, plan });
    expect(wide.selected.length).toBeGreaterThan(2);
    expect(wide.selected.length).toBeLessThanOrEqual(5);
  });

  it("meets every block's count before one section takes the spares", () => {
    // Section counts 5 and 1 at a length of 6: the best-ranked leftovers belong to the count-1 section,
    // but its count is met, so the room goes to the section still short of its own (CodeRabbit, #418).
    const other = homeSection("ai_ux_interaction_patterns") ?? "ai";
    const mixed = [
      ...Array.from({ length: 4 }, (_, n) =>
        scoredIn("ai_ux_interaction_patterns", 0.95 - n * 0.01, n + 20),
      ),
      ...Array.from({ length: 6 }, (_, n) =>
        scoredIn("design_engineering_craft", 0.8 - n * 0.01, n + 1),
      ),
    ];
    const counted = sectionPlanFor(
      blocks([
        { type: "hello" },
        { type: "section", id: home, max_stories: 5 },
        { type: "section", id: other, max_stories: 1 },
        { type: "sign_off" },
      ]),
    );
    const result = selectItems({
      scored: mixed,
      kind: "regular",
      floor: 1,
      cap: 12,
      total: 6,
      plan: counted,
    });
    const taken = (section: string) =>
      result.selected.filter((item) => item.section === section).length;
    expect(taken(home)).toBe(5);
    expect(taken(other)).toBe(1);
  });

  it("meets a release-news count above the per-section target, and a release does not use up its home section's count", () => {
    // Release stories air under release news, so they neither use up their home section's count nor
    // stop short of their own at 3 (CodeRabbit, #418).
    const release = (n: number) => scoredIn("developer_tool_launches", 0.7 - n * 0.01, n + 40);
    const spareFirst = [
      ...Array.from({ length: 8 }, (_, n) =>
        scoredIn("ai_ux_interaction_patterns", 0.95 - n * 0.01, n + 20),
      ),
      ...Array.from({ length: 7 }, (_, n) =>
        scoredIn("software_engineering_depth", 0.8 - n * 0.01, n + 60),
      ),
      ...Array.from({ length: 5 }, (_, n) => release(n)),
    ].map((scoredItem, n) => {
      const isRelease = scoredItem.topCategory === "developer_tool_launches";
      const title = isRelease ? `Library ${n} 2.0 ships` : scoredItem.item.title;
      return { ...scoredItem, item: { ...scoredItem.item, title } };
    });
    const counted = sectionPlanFor(
      blocks([
        { type: "hello" },
        { type: "section", id: "ai", max_stories: 1 },
        { type: "section", id: "software", max_stories: 5 },
        { type: "release_news", stories: 4 },
        { type: "sign_off" },
      ]),
    );
    const result = selectItems({
      scored: spareFirst,
      kind: "regular",
      floor: 1,
      cap: 20,
      total: 10,
      plan: counted,
    });
    const taken = (section: string) =>
      result.selected.filter((item) => item.section === section).length;
    expect(taken("launches")).toBe(4);
    expect(taken("software")).toBe(5);
    expect(taken("ai")).toBe(1);
  });

  it("reserves a section with its own allowance its count before the main sections take spares", () => {
    const own = [
      ...Array.from({ length: 8 }, (_, n) =>
        scoredIn("design_engineering_craft", 0.9 - n * 0.01, n + 1),
      ),
      ...Array.from({ length: 5 }, (_, n) =>
        scoredIn("consumer_tech_releases", 0.6 - n * 0.01, n + 80),
      ),
    ];
    const counted = sectionPlanFor(
      blocks([
        { type: "hello" },
        { type: "section", id: home, max_stories: 2 },
        { type: "section", id: "tech", max_stories: 4 },
        { type: "sign_off" },
      ]),
    );
    const result = selectItems({
      scored: own,
      kind: "regular",
      floor: 1,
      cap: 20,
      total: 6,
      plan: counted,
    });
    const taken = (section: string) =>
      result.selected.filter((item) => item.section === section).length;
    expect(taken("tech")).toBe(4);
    expect(taken(home)).toBe(2);
  });

  it("keeps to the count when the length asks for no more", () => {
    const narrow = selectItems({ scored, kind: "regular", floor: 1, cap: 12, total: 2, plan });
    expect(narrow.selected).toHaveLength(2);
  });
});

// ep-20261027-2333: eight slots were filled by rank, the structure's scaled caps then cut the design
// side to 6, and each story was asked to carry more than it had. More candidates stand in for the cut.
describe("a Catch up fills its slots after the structure's caps", () => {
  const story = (id: string, section: string): PodcastStory => ({
    item_id: id,
    headline: `Headline ${id}`,
    summary: `Summary ${id}.`,
    source: `Outlet ${id}`,
    url: `https://example.com/${id}`,
    section,
    category: section,
  });
  const capped = blocks([
    { type: "hello" },
    { type: "section", id: "design", max_stories: 2 },
    { type: "sign_off" },
  ]);

  it("keeps the slots full when a block's cap cuts the ranked stories", () => {
    // Ranked: five design stories lead, then the rest. Eight slots hold design x5 and three others,
    // and the cap leaves 2 + 3 = 5.
    const candidates = [
      ...["d1", "d2", "d3", "d4", "d5"].map((id) => story(id, "design")),
      ...["w1", "w2", "w3", "w4", "w5", "w6", "w7"].map((id) => story(id, "world")),
    ];
    expect(shapeStories(candidates.slice(0, 8), capped).stories).toHaveLength(5);
    const fitted = fitStories(candidates, capped, {}, 8);
    expect(fitted.stories).toHaveLength(8);
    expect(fitted.stories.filter((each) => each.section === "design")).toHaveLength(2);
    // The lowest-ranked of the rest go, not the best.
    expect(fitted.stories.map((each) => each.item_id)).toContain("w6");
    expect(fitted.stories.map((each) => each.item_id)).not.toContain("w7");
  });

  // ep-20261030-0025: a 5 minute Catch up on one topic found seven Top picks of other topics and one
  // story of its own; the Top picks block (2 at 5 minutes) cut it to three stories and it aired 2 of 5
  // minutes. A block's count is a proportion, not a ceiling (D218): the length is the limit (#147).
  it("lets the counts give way when nothing else can fill the slots", () => {
    const thin = blocks([
      { type: "hello" },
      { type: "top_picks", stories: 2, depth: "deep" },
      { type: "section", id: "ui-craft", max_stories: 2 },
      { type: "release_news", stories: 1 },
      { type: "sign_off" },
    ]);
    const release = (id: string): PodcastStory => ({
      ...story(id, "world"),
      category: RELEASE_CATEGORY,
    });
    const candidates = [
      ...["t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((id) => story(id, "top")),
      story("u1", "ui-craft"),
      release("r1"),
      release("r2"),
    ];
    expect(shapeStories(candidates, thin).stories).toHaveLength(4);
    const fitted = fitStories(candidates, thin, {}, 12);
    const ids = fitted.stories.map((each) => each.item_id);
    expect(ids).toEqual(expect.arrayContaining(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "u1"]));
    // Release news keeps its own count: it is the first thing the length can do without.
    expect(ids.filter((id) => id.startsWith("r"))).toHaveLength(1);
    // The slots still hold the length: nothing is added beyond them.
    expect(fitStories(candidates, thin, {}, 5).stories).toHaveLength(5);
  });

  // The spares are the best-ranked candidates left, not the first of the earliest block (CodeRabbit, PR 450).
  it("fills the last slot with the best-ranked spare, not the first in block order", () => {
    const two = blocks([
      { type: "hello" },
      { type: "section", id: "design", max_stories: 1 },
      { type: "section", id: "world", max_stories: 1 },
      { type: "sign_off" },
    ]);
    const candidates = [
      story("w1", "world"),
      story("w2", "world"),
      story("d1", "design"),
      story("d2", "design"),
    ];
    const ids = fitStories(candidates, two, {}, 3).stories.map((each) => each.item_id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("w2");
    expect(ids).not.toContain("d2");
  });

  it("airs an item that came from two groups once when it fills a slot", () => {
    const two = blocks([
      { type: "hello" },
      { type: "section", id: "design", max_stories: 1 },
      { type: "sign_off" },
    ]);
    const candidates = [
      story("d1", "design"),
      story("w1", "world"),
      story("w1", "world"),
      story("w2", "world"),
    ];
    const ids = fitStories(candidates, two, {}, 3).stories.map((each) => each.item_id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  // The wide selection lists a mixed episode's topics one after another; cutting it by position took
  // the whole last topic (independent review, PR 391).
  it("cuts each section's tail first, so a later topic keeps its best stories", () => {
    const candidates = [
      ...["a1", "a2", "a3", "a4"].map((id) => story(id, "topic-a")),
      ...["b1", "b2", "b3", "b4"].map((id) => story(id, "topic-b")),
    ];
    const fitted = fitStories(candidates, capped, {}, 4).stories.map((each) => each.item_id);
    expect(fitted.filter((id) => id.startsWith("a"))).toHaveLength(2);
    expect(fitted.filter((id) => id.startsWith("b"))).toHaveLength(2);
    expect(fitted).toContain("b1");
  });

  // A release story keeps its world section on the card but airs in the release block, so the cut
  // ranks it there: ranked by section it sat third behind two world stories and went first
  // (CodeRabbit, PR 391, second round).
  it("ranks a release story by the block it airs in, not by its section", () => {
    const withRelease = blocks([
      { type: "hello" },
      { type: "section", id: "world" },
      { type: "release_news", stories: 2 },
      { type: "sign_off" },
    ]);
    const release: PodcastStory = { ...story("r1", "world"), category: RELEASE_CATEGORY };
    const candidates = [story("w1", "world"), story("w2", "world"), release];
    const fitted = fitStories(candidates, withRelease, {}, 2).stories.map((each) => each.item_id);
    expect(fitted).toContain("r1");
    expect(fitted).toContain("w1");
  });

  // A story the structure's per-outlet limit turns away never airs, so it must not take a place in the
  // rank either: counted, it pushed the block's next story behind another block's second one
  // (CodeRabbit, PR 391, third round).
  it("ranks only the stories that air, so a turned-away story takes no place", () => {
    const limited = blocks([
      { type: "hello" },
      { type: "section", id: "world", per_source: 1 },
      { type: "section", id: "design" },
      { type: "sign_off" },
    ]);
    const at = (id: string, section: string, host: string): PodcastStory => ({
      ...story(id, section),
      url: `https://${host}/${id}`,
    });
    const candidates = [
      at("w1", "world", "a.example"),
      at("w2", "world", "a.example"),
      at("w3", "world", "b.example"),
      at("d1", "design", "c.example"),
      at("d2", "design", "d.example"),
    ];
    const fitted = fitStories(candidates, limited, {}, 3).stories.map((each) => each.item_id);
    expect(fitted).not.toContain("w2");
    expect(fitted).toContain("w3");
    expect(fitted).toHaveLength(3);
  });

  // A short episode with many blocks plans one slot; selection kept two, and fitting must not cut
  // under what selection kept (CodeRabbit, PR 391).
  it("never cuts an episode under two stories, whatever the structure left room for", () => {
    const many = Array.from({ length: 5 }, (_, i) => story(`w${i}`, "world"));
    expect(fitStories(many, capped, {}, 1).stories).toHaveLength(2);
    expect(fitStories(many, capped, {}, 0).stories).toHaveLength(2);
  });

  it("is what shapeStories gives when nothing is cut, and holds the slot count", () => {
    const few = [story("d1", "design"), story("w1", "world")];
    expect(fitStories(few, capped, {}, 8)).toEqual(shapeStories(few, capped, {}));
    const many = Array.from({ length: 6 }, (_, i) => story(`w${i}`, "world"));
    expect(fitStories(many, capped, {}, 4).stories.map((each) => each.item_id)).toEqual([
      "w0",
      "w1",
      "w2",
      "w3",
    ]);
  });
});

describe("a structured Catch up script over its length", () => {
  it("gives up its close before any story and keeps the sign-off", () => {
    const turns = [
      { speaker: "a" as const, text: "This is Singularity." },
      { speaker: "a" as const, text: "x".repeat(100), item_id: "one" },
      { speaker: "a" as const, text: "y".repeat(100), item_id: "two" },
      { speaker: "a" as const, text: "A close that runs on.".repeat(3) },
      { speaker: "a" as const, text: "Bye." },
    ];
    const budget = 20 + 200 + 4 + 10;
    const fitted = fitToBudget(turns, budget, { closeFirst: true });
    expect(fitted.dropped_stories).toBe(0);
    expect(fitted.turns.map((turn) => turn.text.slice(0, 4))).toEqual([
      "This",
      "xxxx",
      "yyyy",
      "Bye.",
    ]);
  });
});

it("a Catch up block's own prompt reaches the script delimited, once, before its stories, and the rest keep the built-in prompt (D182)", () => {
  const story = (id: string, section: string): PodcastStory => ({
    item_id: id,
    headline: `Headline ${id}`,
    summary: `Summary ${id}.`,
    source: "Example",
    url: `https://example.com/${id}`,
    section,
    category: section,
  });
  const stories = [story("d1", "design"), story("d2", "design"), story("a1", "ai")];
  const design = "Tell each design story through what a designer would try first.";
  const close = "End on one question a designer could take into tomorrow.";
  const { stories: ordered, shape } = shapeStories(stories, defaultStructure("catch_up"), {
    "section:design": design,
    close,
  });
  const input = { request: REQUEST, stories: ordered, budget_chars: 4000, shape };
  const user = scriptUserMessage(input, "BND", []);
  expect(user.split(design)).toHaveLength(2);
  expect(user.split(close)).toHaveLength(2);
  // Delimited as the owner's typed text, before the first design story.
  expect(user.indexOf(design)).toBeGreaterThan(user.indexOf("BND"));
  expect(user.indexOf(design)).toBeLessThan(user.indexOf("item_id: d1"));
  const tellings = [...user.matchAll(/item_id: (\w+)\nTelling: (.+)/g)].map((m) => [m[1], m[2]]);
  expect(tellings.filter(([, telling]) => telling?.endsWith("as the owner instructs"))).toEqual([
    ["d1", expect.any(String)],
    ["d2", expect.any(String)],
  ]);
  const system = scriptSystemPrompt(input);
  expect(system).toContain("the close, as the OWNER INSTRUCTIONS");
  expect(system).not.toContain("the hello, as the OWNER INSTRUCTIONS");
});

it("a block's own count per source decides what it carries, whatever the model wrote (D170)", () => {
  const story = (url: string, score: number, published_at: string): ScoredItem => {
    const item = makeItem({ url, canonical_url: url, published_at });
    const entry = makeEntry(item, { category: "design_engineering_craft" });
    const breakdown = { taste: score, craftFactor: 1, penaltyFactor: 1, bonus: 0 };
    return { item, entry, score, topCategory: "design_engineering_craft", breakdown };
  };
  const first = story("https://same.example/a", 0.9, "2026-10-24T02:00:00Z");
  const second = story("https://same.example/b", 0.85, "2026-10-24T03:00:00Z");
  const other = story("https://other.example/c", 0.8, "2026-10-23T12:00:00Z");
  const plan = sectionPlanFor(
    blocks([
      { type: "hello" },
      { type: "section", id: "ui-craft", per_source: 1 },
      { type: "sign_off" },
    ]),
  );
  const result = selectItems({
    scored: [first, second, other],
    kind: "regular",
    floor: 1,
    cap: 12,
    plan,
  });
  expect(result.selected.map((selected) => selected.item.id)).toEqual([
    first.item.id,
    other.item.id,
  ]);
  const reasons = new Map(result.dropped.map((d) => [d.id, d.reason]));
  expect(reasons.get(second.item.id)).toBe("over_outlet");
});
