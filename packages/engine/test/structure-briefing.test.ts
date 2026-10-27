import {
  type Category,
  defaultStructure,
  digestSections,
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
import { sectionPlanFor } from "../src/score/sectionPlan.js";
import { selectItems } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { REQUEST } from "./podcast-fixtures.js";
import { buildFixtureDigest } from "./render-factories.js";
import { makeEntry, makeItem } from "./score-factories.js";

const blocks = (input: StructureBlockInput[]) => StructureBlocks.parse(input);

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
