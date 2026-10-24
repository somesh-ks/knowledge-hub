import {
  defaultStructure,
  digestSections,
  parseDigestFile,
  type StructureBlockInput,
  StructureBlocks,
  serializeDigestFile,
} from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { buildSpokenText } from "../src/audio/spokenText.js";
import { fitToBudget } from "../src/podcast/fit.js";
import { sectionPlanFor } from "../src/score/sectionPlan.js";
import { buildFixtureDigest } from "./render-factories.js";

const blocks = (input: StructureBlockInput[]) => StructureBlocks.parse(input);

describe("a briefing follows its stored structure (D170)", () => {
  it("reads sections in the owner's order on the page and in the narration, after the file is written and read back", () => {
    // Without the snapshot, digestSections falls back to the built-in order and the edit is lost.
    const plan = sectionPlanFor(
      blocks([
        { type: "hello" },
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

  it("a saved structure equal to the defaults writes the same briefing as no structure", () => {
    const plain = buildFixtureDigest(12).digest;
    const saved = buildFixtureDigest(12, {
      plan: sectionPlanFor(defaultStructure("daily")),
    }).digest;
    expect(serializeDigestFile(saved)).toBe(serializeDigestFile(plain));
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
