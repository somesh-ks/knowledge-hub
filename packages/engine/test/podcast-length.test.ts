import type { PodcastFormat, PodcastRequest } from "@singularity/core";
import { describe, expect, it } from "vitest";
import {
  deepDiveCount,
  NUGGET_CAPACITY_CHARS,
  partChars,
  planPodcast,
  reachableChars,
  STORY_CAPACITY_CHARS,
  scriptFloorChars,
  scriptTargetChars,
  structureFor,
  wordsFor,
} from "../src/podcast/plan.js";
import { scriptSystemPrompt } from "../src/podcast/prompt.js";
import { closestId, generateScript } from "../src/podcast/script.js";
import type { PodcastStory, ScriptInput } from "../src/podcast/types.js";
import { FakeScriptWriter, itemId, padFor, REQUEST, scriptOf } from "./podcast-fixtures.js";

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
      const reach = reachableChars(budget, stories, format, minutes);
      const prompt = scriptSystemPrompt(input);
      expect(scriptTargetChars(budget)).toBe(Math.floor(budget * 0.95));
      expect(scriptFloorChars(budget)).toBe(Math.floor(budget * 0.8));
      // The plan gives a format as many stories as its length carries, so the whole length is in reach.
      expect(reach).toBe(budget);
      // The writer is told the target, the floor and the ceiling, in words (not the wording itself).
      expect(prompt).toContain(`about ${wordsFor(scriptTargetChars(reach))} words in total`);
      expect(prompt).toContain(`under ${wordsFor(scriptFloorChars(reach))} words is rejected`);
      expect(prompt).toContain(`${wordsFor(reach)} words is the ceiling`);
      const parts = partChars(reach, stories, format, minutes);
      if (format === "headlines") {
        expect(prompt).toContain(`about ${wordsFor(parts.nugget)} words on each of the ${stories}`);
      } else {
        const deep = deepDiveCount(minutes, stories);
        expect(prompt).toContain(
          `each of the ${stories - deep} nuggets about ${wordsFor(parts.nugget)} words`,
        );
        if (deep > 0) {
          expect(prompt).toContain(
            `each of the ${deep} deep dives about ${wordsFor(parts.deep_dive)} words`,
          );
          expect(parts.deep_dive).toBeGreaterThan(parts.nugget);
        } else {
          expect(prompt).not.toContain("deep dives about");
        }
      }
      // Characters are never asked for: a model keeps to words far better.
      expect(prompt).not.toMatch(/\d+ characters/);
    },
  );

  it("aims at what the stories can carry when they cannot fill the length asked for", () => {
    const full = inputFor("readout", 15);
    const thin = inputFor("readout", 15, 4);
    const reach = reachableChars(thin.budget_chars, 4, "readout", 15);
    const structure = structureFor(15, 4, "readout");
    expect(reach).toBe(
      structure.frame_chars +
        structure.deep_dives * STORY_CAPACITY_CHARS.readout +
        structure.nuggets * NUGGET_CAPACITY_CHARS.readout,
    );
    expect(reach).toBeLessThan(thin.budget_chars);
    expect(reachableChars(full.budget_chars, full.stories.length, "readout", 15)).toBe(
      full.budget_chars,
    );
    const prompt = scriptSystemPrompt(thin);
    expect(prompt).toContain(`${wordsFor(reach)} words is the ceiling`);
    expect(prompt).toContain("Never pad with filler and never repeat a fact.");
    // A discussion carries more per story than a readout, and headlines far less.
    expect(reachableChars(99_999, 4, "discussion", 15)).toBeGreaterThan(reach);
    expect(reachableChars(99_999, 4, "headlines", 15)).toBeLessThan(reach);
  });

  it("tells more stories at length when too few come to fill the length asked for", () => {
    // ep-20261025-1746: seven stories for five minutes aired at 72% of the budget, because one deep
    // dive and six nuggets can carry only 83% of it.
    const budget = planPodcast({ ...REQUEST, format: "readout", length_minutes: 5 }).budget_chars;
    expect(reachableChars(budget, 7, "readout", 5)).toBe(budget);
    expect(structureFor(5, 7, "readout").deep_dives).toBeGreaterThan(1);
    // Never more deep dives than stories, and no promotion once the stories fill the length.
    expect(structureFor(15, 4, "readout").deep_dives).toBe(4);
    const full = planPodcast({ ...REQUEST, format: "readout", length_minutes: 15 });
    expect(structureFor(15, full.max_stories, "readout").deep_dives).toBe(
      deepDiveCount(15, full.max_stories),
    );
  });

  it("asks a discussion for full turns,and lets a host give a view but not a fact", () => {
    const prompt = scriptSystemPrompt(inputFor("discussion", 5));
    expect(prompt).toContain("Turns run one to four sentences each");
    expect(prompt).toContain("clearly as their own view");
    expect(prompt).toContain("Neither host invents a fact, a number, a quote or a motive.");
  });

  it("keeps the arithmetic whole: the frame is taken out, deep dives weigh more than nuggets", () => {
    expect(planPodcast({ ...REQUEST, length_minutes: 5 }).budget_chars).toBe(4840);
    const budget = 4840;
    const parts = partChars(budget, 9, "readout", 5);
    const structure = structureFor(5, 9, "readout");
    expect(parts.deep_dive).toBeGreaterThan(parts.nugget);
    expect(
      structure.frame_chars +
        structure.deep_dives * parts.deep_dive +
        structure.nuggets * parts.nugget,
    ).toBeLessThanOrEqual(budget);
  });
});

describe("the episode structure", () => {
  it.each([
    [3, 0],
    [5, 1],
    [10, 2],
    [15, 3],
  ] as const)("gives a %i minute episode its base of deep dives (%i)", (minutes, deep) => {
    expect(deepDiveCount(minutes, 8)).toBe(deep);
  });

  it("is a pure function of length and story count, grows with both, and never exceeds the stories", () => {
    expect(deepDiveCount(10, 9)).toBe(2);
    expect(deepDiveCount(10, 10)).toBe(3);
    expect(deepDiveCount(15, 13)).toBe(3);
    expect(deepDiveCount(15, 14)).toBe(4);
    expect(deepDiveCount(15, 2)).toBe(2);
    expect(deepDiveCount(5, 0)).toBe(0);
    for (const stories of [1, 4, 8, 12, 20, 40]) {
      let last = 0;
      for (const minutes of LENGTHS) {
        const count = deepDiveCount(minutes, stories);
        expect(count).toBeGreaterThanOrEqual(last);
        expect(count).toBeLessThanOrEqual(stories);
        last = count;
      }
    }
  });

  it("plans more stories than the old flat frame at every length, never over budget", () => {
    for (const format of ["readout", "discussion"] as const) {
      for (const minutes of LENGTHS) {
        const plan = planPodcast({ ...REQUEST, format, length_minutes: minutes });
        expect(plan.max_stories).toBeGreaterThan(deepDiveCount(minutes, plan.max_stories));
      }
    }
  });
});

describe("the prompt per length", () => {
  const prompts = Object.fromEntries(
    LENGTHS.map((minutes) => [minutes, scriptSystemPrompt(inputFor("readout", minutes, 8))]),
  ) as Record<(typeof LENGTHS)[number], string>;

  it("orders every episode: hello, rundown, stories, close, sign-off", () => {
    for (const minutes of LENGTHS) {
      expect(prompts[minutes]).toContain("STRUCTURE, in this order: 1) a one-line hello");
      expect(prompts[minutes]).toContain("the rundown: name the first");
      expect(prompts[minutes]).toContain("a short close; 5) a one-line sign-off");
      expect(prompts[minutes]).toContain(
        "The hello, rundown, close and sign-off carry no item_id.",
      );
    }
  });

  it("allows no invented opinions in the close", () => {
    expect(prompts[10]).toContain("only when a story block contains a reaction or a quote");
    expect(prompts[10]).toContain("Never invent an opinion, a reaction");
  });

  it("has no deep dives at 3 minutes and more of them as the length grows", () => {
    expect(prompts[3]).toContain("There are no deep dives in this episode");
    // Eight stories are too few to fill 5 minutes or more with nuggets, so more are told at length.
    expect(prompts[5]).not.toContain("no deep dives");
    expect(prompts[15]).not.toContain("no deep dives");
  });

  it("names fewer lead stories in the rundown than it tells in long episodes", () => {
    expect(prompts[3]).toContain("name the first 3 stories");
    expect(prompts[15]).toContain("name the first 5 stories");
  });

  it("asks a longer close of a longer episode", () => {
    const words = (minutes: (typeof LENGTHS)[number]): number => {
      const match = prompts[minutes].match(/the close about (\d+) words/);
      return Number(match?.[1]);
    };
    expect(words(3)).toBeLessThan(words(5));
    expect(words(5)).toBeLessThan(words(10));
    expect(words(10)).toBeLessThan(words(15));
  });

  it("describes the discussion and the legacy headlines shape", () => {
    const duo = scriptSystemPrompt(inputFor("discussion", 10));
    expect(duo).toContain("A deep dive is four to six turns");
    expect(duo).toContain("The close is");
    const legacy = scriptSystemPrompt(inputFor("headlines", 5));
    expect(legacy).toContain("Open with one sentence that says the show is Singularity.");
    expect(legacy).not.toContain("STRUCTURE");
  });

  it("explains terms for a general audience and leaves the custom prompt alone", () => {
    const base = inputFor("readout", 10);
    const general = scriptSystemPrompt({
      ...base,
      request: { ...base.request, audience: "general" },
    });
    expect(general).toContain("Explain any technical term");
    expect(general).toContain("STRUCTURE");
    expect(prompts[10]).not.toContain("Explain any technical term");
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
      /too short by about \d+ words.*Every deep dive needs about \d+ words and every nugget about \d+\..*Add depth to these stories first: "Story \d/,
    );
    expect(result.short_by_chars).toBe(0);
    const chars = result.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(chars).toBeGreaterThanOrEqual(
      scriptFloorChars(
        reachableChars(input.budget_chars, 4, "readout", input.request.length_minutes),
      ),
    );
  });

  it("does not ask for a rewrite when the stories cannot carry the length asked for", async () => {
    // Four stories can carry 2,900 characters of a 15 minute readout; a reply that fills that is
    // accepted at once, and the shortfall against the 15 minutes is still recorded.
    const input = inputFor("readout", 15, 4);
    const reach = reachableChars(input.budget_chars, 4, "readout", input.request.length_minutes);
    const filler = "A plain sentence about the milestone that says nothing new. ".repeat(30);
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

  it("sends an under-delivered script back once to be extended, and keeps the longer one", async () => {
    // ep-20261025-1746 aired at 72% of its length: the writer under-delivers and nothing asked again.
    const input = inputFor("readout", 5, 4);
    const reach = reachableChars(input.budget_chars, 4, "readout", 5);
    const long = { ...input, budget_chars: Math.floor(input.budget_chars * 1.05) };
    const extended = scriptOf(input, padFor(long, false));
    let extendCalls = 0;
    const writer = Object.assign(new FakeScriptWriter((i) => scriptOf(i, "short.")), {
      extendScript: async () => {
        extendCalls += 1;
        return extended;
      },
    });
    const result = await run(input, writer);
    const chars = result.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    expect(extendCalls).toBe(1);
    expect(chars).toBeGreaterThanOrEqual(Math.floor(reach * 0.9));
  });

  it("plans 12 stories for 15 minutes at 90% of the length or more", () => {
    // Twelve stories reached 61% of 15 minutes: each is told longer, up to a cap, before the
    // episode is called short.
    const budget = planPodcast({ ...REQUEST, format: "readout", length_minutes: 15 }).budget_chars;
    expect(reachableChars(budget, 12, "readout", 15)).toBeGreaterThanOrEqual(
      Math.floor(budget * 0.9),
    );
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
