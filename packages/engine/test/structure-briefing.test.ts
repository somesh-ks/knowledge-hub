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
import { sectionPlanFor } from "../src/score/sectionPlan.js";
import { selectItems } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
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
