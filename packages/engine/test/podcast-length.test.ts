import type { PodcastFormat, PodcastRequest } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  perStoryChars,
  planPodcast,
  scriptFloorChars,
  scriptTargetChars,
} from "../src/podcast/plan.js";
import { scriptSystemPrompt } from "../src/podcast/prompt.js";
import { generateScript } from "../src/podcast/script.js";
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
    "states the range and the per-story target for a %s of %i minutes",
    (format, minutes) => {
      const input = inputFor(format, minutes);
      const budget = input.budget_chars;
      const prompt = scriptSystemPrompt(input, "BOUNDARY");
      expect(scriptTargetChars(budget)).toBe(Math.floor(budget * 0.9));
      expect(scriptFloorChars(budget)).toBe(Math.floor(budget * 0.8));
      expect(prompt).toContain(
        `must land between ${scriptTargetChars(budget)} and ${budget} characters.`,
      );
      expect(prompt).toContain(
        `about ${perStoryChars(budget, input.stories.length)} characters for each of the ${input.stories.length} stories`,
      );
      expect(prompt).toContain(
        `A script under ${scriptFloorChars(budget)} characters is rejected.`,
      );
    },
  );

  it("goes deeper per story when there are fewer stories than the length can carry", () => {
    const many = inputFor("readout", 5);
    const few = inputFor("readout", 5, 3);
    expect(perStoryChars(few.budget_chars, 3)).toBeGreaterThan(
      perStoryChars(many.budget_chars, many.stories.length),
    );
    expect(scriptSystemPrompt(few, "B")).toContain(
      "go deeper on each one: say what happened, who is involved and what the summary gives as the catch.",
    );
    expect(scriptSystemPrompt(few, "B")).toContain(
      "Never pad with filler and never repeat a fact.",
    );
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
      /too short by \d+ characters.*Add depth to these stories first: "Story \d/,
    );
    expect(result.short_by_chars).toBe(0);
    const chars = result.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(chars).toBeGreaterThanOrEqual(scriptFloorChars(input.budget_chars));
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
