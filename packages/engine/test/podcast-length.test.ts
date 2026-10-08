import type { PodcastFormat, PodcastRequest } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  perStoryChars,
  planPodcast,
  reachableChars,
  STORY_CAPACITY_CHARS,
  scriptFloorChars,
  scriptTargetChars,
  wordsFor,
} from "../src/podcast/plan.js";
import { scriptSystemPrompt } from "../src/podcast/prompt.js";
import { closestId, generateScript } from "../src/podcast/script.js";
import type { PodcastStory, ScriptInput } from "../src/podcast/types.js";
import { FakeScriptWriter, itemId, REQUEST, scriptOf } from "./podcast-fixtures.js";

const LENGTHS = [3, 5, 10, 15] as const;
const FORMATS = ["readout", "discussion", "headlines"] as const;

function storiesOf(count: number): PodcastStory[] {
  return Array.from({ length: count }, (_, i) => ({
    item_id: itemId(i + 1),
    headline: `Story ${i + 1} reaches a milestone`,
    summary: `Wire reports that story ${i + 1} reached a milestone.`,
    source: "Wire",
    url: `https://example.com/story-${i + 1}`,
    section: "ai",
    category: "frontier_model_releases",
  }));
}

function inputFor(format: PodcastFormat, minutes: 3 | 5 | 10 | 15, count?: number): ScriptInput {
  const request: PodcastRequest = { ...REQUEST, format, length_minutes: minutes };
  const plan = planPodcast(request);
  return {
    request,
    stories: storiesOf(count ?? plan.max_stories),
    budget_chars: plan.budget_chars,
  };
}

async function run(input: ScriptInput, writer: FakeScriptWriter) {
  return generateScript({
    writer,
    request: input.request,
    stories: input.stories,
    budget_chars: input.budget_chars,
  });
}

describe("the length asked of the writer", () => {
  const cases = FORMATS.flatMap((format) => LENGTHS.map((minutes) => [format, minutes] as const));

  it.each(cases)(
    "states the length in words and per story for a %s of %i minutes",
    (format, minutes) => {
      const input = inputFor(format, minutes);
      const budget = input.budget_chars;
      const stories = input.stories.length;
      const reach = reachableChars(budget, stories, format);
      const prompt = scriptSystemPrompt(input, "BOUNDARY");
      expect(scriptTargetChars(budget)).toBe(Math.floor(budget * 0.9));
      expect(scriptFloorChars(budget)).toBe(Math.floor(budget * 0.8));
      // The plan gives a format as many stories as its length carries, so the whole length is in reach.
      expect(reach).toBe(budget);
      expect(prompt).toContain(
        `Write about ${wordsFor(scriptTargetChars(reach))} words in total, all turns together, and no more than ${wordsFor(reach)}.`,
      );
      expect(prompt).toContain(
        `A script under ${wordsFor(scriptFloorChars(reach))} words is rejected as too short.`,
      );
      expect(prompt).toContain(
        `about ${wordsFor(perStoryChars(reach, stories))} words on each of the ${stories} stories`,
      );
      // Characters are never asked for: a model keeps to words far better.
      expect(prompt).not.toMatch(/\d+ characters/);
    },
  );

  it("aims at what the stories can carry when they cannot fill the length asked for", () => {
    const full = inputFor("readout", 15);
    const thin = inputFor("readout", 15, 4);
    const reach = reachableChars(thin.budget_chars, 4, "readout");
    expect(reach).toBe(300 + 4 * STORY_CAPACITY_CHARS.readout);
    expect(reach).toBeLessThan(thin.budget_chars);
    expect(reachableChars(full.budget_chars, full.stories.length, "readout")).toBe(
      full.budget_chars,
    );
    const prompt = scriptSystemPrompt(thin, "B");
    expect(prompt).toContain(`no more than ${wordsFor(reach)}.`);
    expect(prompt).toContain("Never pad with filler and never repeat a fact.");
    // A discussion carries more per story than a readout, and headlines far less.
    expect(reachableChars(99_999, 4, "discussion")).toBeGreaterThan(reach);
    expect(reachableChars(99_999, 4, "headlines")).toBeLessThan(reach);
  });

  it("asks a discussion for full turns, and lets a host give a view but not a fact", () => {
    const prompt = scriptSystemPrompt(inputFor("discussion", 5), "B");
    expect(prompt).toContain("run two to four sentences each");
    expect(prompt).toContain("clearly as their own view");
    expect(prompt).toContain("Neither host invents a fact, a number, a quote or a motive.");
  });

  it("keeps the arithmetic whole: the opening and sign-off are taken out first", () => {
    // 5 minutes is 4,840 characters; 4,840 less the 300 of framing, over 4 stories, is 1,135.
    expect(planPodcast({ ...REQUEST, length_minutes: 5 }).budget_chars).toBe(4840);
    expect(perStoryChars(4840, 4)).toBe(1135);
    expect(perStoryChars(4840, 0)).toBe(4540);
  });
});

describe("the length floor", () => {
  it("passes a reply inside the range on the first call", async () => {
    const input = inputFor("readout", 5, 4);
    const writer = new FakeScriptWriter((i) => scriptOf(i));
    const result = await run(input, writer);
    expect(writer.calls).toHaveLength(1);
    expect(result.short_by_chars).toBe(0);
  });

  it("rejects a short reply with the too-short problem and takes the longer second one", async () => {
    const input = inputFor("readout", 5, 4);
    const writer = new FakeScriptWriter((i, call) =>
      scriptOf(i, call === 0 ? "short." : undefined),
    );
    const result = await run(input, writer);
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[1]?.problems.join(" ")).toMatch(
      /too short by about \d+ words.*Every story needs about \d+ words\..*Add depth to these stories first: "Story \d/,
    );
    expect(result.short_by_chars).toBe(0);
    const chars = result.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(chars).toBeGreaterThanOrEqual(
      scriptFloorChars(reachableChars(input.budget_chars, 4, "readout")),
    );
  });

  it("does not ask for a rewrite when the stories cannot carry the length asked for", async () => {
    // Four stories can carry 2,900 characters of a 15 minute readout; a reply that fills that is
    // accepted at once, and the shortfall against the 15 minutes is still recorded.
    const input = inputFor("readout", 15, 4);
    const reach = reachableChars(input.budget_chars, 4, "readout");
    const filler = "A plain sentence about the milestone that says nothing new. ".repeat(12);
    const writer = new FakeScriptWriter((i) => scriptOf(i, filler.slice(0, Math.ceil(reach / 4))));
    const result = await run(input, writer);
    expect(writer.calls).toHaveLength(1);
    expect(result.short_by_chars).toBeGreaterThan(0);
  });

  it("keeps the longest of the short replies, not the last", async () => {
    const input = inputFor("readout", 5, 4);
    const writer = new FakeScriptWriter((i, call) =>
      scriptOf(i, call === 0 ? "A somewhat longer line than the others manage." : "short."),
    );
    const result = await run(input, writer);
    expect(writer.calls).toHaveLength(3);
    expect(result.turns.some((turn) => turn.text.includes("somewhat longer"))).toBe(true);
  });

  it("keeps the last reply when every one is short, and records the shortfall", async () => {
    const input = inputFor("readout", 5, 4);
    const writer = new FakeScriptWriter((i) => scriptOf(i, "short."));
    const result = await run(input, writer);
    expect(writer.calls).toHaveLength(3);
    const chars = result.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(result.short_by_chars).toBe(scriptFloorChars(input.budget_chars) - chars);
    expect(result.short_by_chars).toBeGreaterThan(0);
    expect(result.turns.length).toBeGreaterThan(3);
  });

  it.each(FORMATS.flatMap((f) => LENGTHS.map((m) => [f, m] as const)))(
    "accepts a default %s of %i minutes without a retry",
    async (format, minutes) => {
      const input = inputFor(format, minutes);
      const writer = new FakeScriptWriter((i) => scriptOf(i));
      const result = await run(input, writer);
      expect(writer.calls).toHaveLength(1);
      expect(result.short_by_chars).toBe(0);
    },
  );
});

describe("a mistyped story id", () => {
  const known = new Set(["cef364b6dcb9", "a1b2c3d4e5f6", "a1b2c3d4ffff"]);

  it("is taken as the one id it can only mean", () => {
    expect(closestId("cef364b6dcb", known)).toBe("cef364b6dcb9");
    expect(closestId("cef364b6dcb99", known)).toBe("cef364b6dcb9");
    expect(closestId("cef364b6XXXX", known)).toBe("cef364b6dcb9");
  });

  it("is left alone when two ids share the start, or nothing does, or it is too short to tell", () => {
    expect(closestId("a1b2c3d4e5f", known)).toBe("a1b2c3d4e5f");
    expect(closestId("000000000000", known)).toBe("000000000000");
    expect(closestId("cef36", known)).toBe("cef36");
  });
});
