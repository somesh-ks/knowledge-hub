import type { PodcastFormat } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { numbersIn } from "../src/podcast/check.js";
import { planPodcast, STORY_CAPACITY_CHARS } from "../src/podcast/plan.js";
import { generateScript, validateReply } from "../src/podcast/script.js";
import { PodcastError, type PodcastStory, type ScriptInput } from "../src/podcast/types.js";
import { FakeScriptWriter, itemId, REQUEST, scriptOf } from "./podcast-fixtures.js";

function storiesOf(count: number): PodcastStory[] {
  return Array.from({ length: count }, (_, i) => ({
    item_id: itemId(i + 1),
    headline: `Model ${i + 1} ships with a new planner`,
    summary: `Example Wire reports that model ${i + 1} adds a planner. It cuts latency by 40 percent. The catch is that it needs a new runtime.`,
    source: "Example Wire",
    url: `https://example.com/story-${i + 1}`,
    section: "ai",
    category: "frontier_model_releases",
  }));
}

function inputFor(
  format: PodcastFormat,
  minutes: 3 | 5 | 10 | 15,
  storyCount: number,
): ScriptInput {
  const request = { ...REQUEST, format, length_minutes: minutes };
  return {
    request,
    stories: storiesOf(storyCount),
    budget_chars: planPodcast(request).budget_chars,
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

describe("the budget", () => {
  const cases: Array<[PodcastFormat, 3 | 5 | 10 | 15]> = [];
  for (const format of ["readout", "discussion", "headlines"] as const) {
    for (const minutes of [3, 5, 10, 15] as const) cases.push([format, minutes]);
  }

  it.each(cases)(
    "keeps a %s of %i minutes inside its characters, whole turns only",
    async (format, minutes) => {
      // Every turn is padded to roughly twice what its story may use, so the budget has to bite.
      const input = inputFor(
        format,
        minutes,
        planPodcast(inputFor(format, minutes, 1).request).max_stories,
      );
      const fill = "x".repeat(
        format === "discussion"
          ? STORY_CAPACITY_CHARS[format] / 2
          : STORY_CAPACITY_CHARS[format] * 2,
      );
      const writer = new FakeScriptWriter((i) => scriptOf(i, fill));
      const generated = new Set(scriptOf(input, fill).turns.map((turn) => turn.text));

      const result = await run(input, writer);
      const chars = result.turns.reduce((sum, turn) => sum + turn.text.length, 0);
      expect(chars).toBeLessThanOrEqual(input.budget_chars);
      expect(result.dropped_stories).toBeGreaterThan(0);
      // Neighbours of one host and one story are joined, so a turn is whole generated turns.
      for (const turn of result.turns) {
        expect([...generated].some((text) => turn.text.includes(text))).toBe(true);
      }
      // What survives is a prefix of the stories, in order, followed by the sign-off.
      const ids = [...new Set(result.turns.flatMap((t) => (t.item_id ? [t.item_id] : [])))];
      expect(ids).toEqual(input.stories.slice(0, ids.length).map((s) => s.item_id));
      expect(result.turns.at(-1)?.text).toMatch(/That is Singularity for now\.$/);
    },
  );

  it("leaves a script that already fits untouched", async () => {
    const input = inputFor("readout", 10, 4);
    const result = await run(input, new FakeScriptWriter());
    expect(result.dropped_stories).toBe(0);
    expect(result.turns).toHaveLength(6);
  });

  it("fails when even one story does not fit", async () => {
    const input = inputFor("readout", 3, 2);
    const writer = new FakeScriptWriter((i) => scriptOf(i, "y".repeat(4000)));
    await expect(run(input, writer)).rejects.toThrow(/does not fit/);
  });
});

describe("a discussion", () => {
  it("alternates its hosts and carries item ids", async () => {
    const input = inputFor("discussion", 10, 4);
    const result = await run(input, new FakeScriptWriter());
    const known = new Set(input.stories.map((s) => s.item_id));
    const turns = result.turns;

    expect(turns[0]?.speaker).toBe("a");
    expect(turns[0]?.item_id).toBeUndefined();
    expect(turns[0]?.text).toMatch(/Singularity/);
    expect(turns.at(-1)?.item_id).toBeUndefined();

    const body = turns.filter((t) => t.item_id !== undefined);
    expect(body.length).toBe(8);
    for (const turn of body) expect(known.has(turn.item_id as string)).toBe(true);
    for (const [index, turn] of turns.entries()) {
      if (index > 0) expect(turn.speaker === turns[index - 1]?.speaker).toBe(false);
    }
    expect(new Set(turns.map((t) => t.speaker))).toEqual(new Set(["a", "b"]));
  });

  it("asks for a reply with both hosts and retries once when only one speaks", async () => {
    const input = inputFor("discussion", 10, 3);
    const writer = new FakeScriptWriter((i, call) => {
      const good = scriptOf(i);
      return call === 0
        ? { turns: good.turns.map((t) => ({ ...t, speaker: "a" as const })) }
        : good;
    });
    const result = await run(input, writer);
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[1]?.problems.join(" ")).toMatch(/speaker "b"/);
    expect(result.turns.some((t) => t.speaker === "b")).toBe(true);
  });
});

describe("a solo format", () => {
  it.each(["readout", "headlines"] as const)("speaks every %s turn as host a", async (format) => {
    const input = inputFor(format, 10, 3);
    const writer = new FakeScriptWriter((i) => ({
      turns: scriptOf(i).turns.map((t, n) => ({ ...t, speaker: n % 2 ? "b" : "a" })),
    }));
    const result = await run(input, writer);
    expect(new Set(result.turns.map((t) => t.speaker))).toEqual(new Set(["a"]));
  });
});

describe("the reply", () => {
  it("is asked for once when it is valid", async () => {
    const writer = new FakeScriptWriter();
    await run(inputFor("readout", 5, 3), writer);
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]?.problems).toEqual([]);
  });

  it("is retried once, with the problems, when it names a story we did not select", async () => {
    const writer = new FakeScriptWriter((i, call) => {
      const good = scriptOf(i);
      return call === 0
        ? { turns: good.turns.map((t) => (t.item_id ? { ...t, item_id: "ffffffffffff" } : t)) }
        : good;
    });
    await run(inputFor("readout", 5, 3), writer);
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[1]?.problems.join(" ")).toMatch(/ffffffffffff/);
  });

  it("is retried when the opening does not name the show", async () => {
    const writer = new FakeScriptWriter((i, call) => {
      const good = scriptOf(i);
      return call === 0
        ? { turns: [{ speaker: "a", text: "Hello there." }, ...good.turns.slice(1)] }
        : good;
    });
    await run(inputFor("readout", 5, 3), writer);
    expect(writer.calls).toHaveLength(2);
  });

  it("fails after the retry when the reply is still unusable", async () => {
    const writer = new FakeScriptWriter(() => ({ turns: "nope" }));
    await expect(run(inputFor("readout", 5, 3), writer)).rejects.toBeInstanceOf(PodcastError);
    expect(writer.calls).toHaveLength(3);
  });

  it("recovers when the first call throws", async () => {
    const writer = new FakeScriptWriter((i, call) => {
      if (call === 0) throw new Error("socket hang up");
      return scriptOf(i);
    });
    await run(inputFor("readout", 5, 3), writer);
    expect(writer.calls).toHaveLength(2);
  });

  it("drops em dashes from the spoken text", () => {
    const input = inputFor("readout", 5, 2);
    const reply = {
      turns: [
        { speaker: "a", text: "Welcome to Singularity — today." },
        { speaker: "a", text: "Model 1 ships — fast.", item_id: itemId(1) },
        { speaker: "a", text: "Bye." },
      ],
    };
    const result = validateReply(reply, input.request, input.stories);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.turns.map((t) => t.text).join(" ")).not.toMatch(/2014/);
  });
});

describe("the number check", () => {
  it("reads numbers the way people write them", () => {
    expect(numbersIn("It cost 2,000 dollars, up 3.5 percent in 2026.")).toEqual([
      "2000",
      "3.5",
      "2026",
    ]);
  });

  it("drops a turn whose invented number survives one rewrite", async () => {
    const input = inputFor("readout", 10, 3);
    const writer = new FakeScriptWriter(
      (i) => {
        const good = scriptOf(i);
        const at = good.turns.findIndex((t) => t.item_id === itemId(2));
        good.turns[at] = {
          speaker: "a",
          text: "It cuts latency by 90 percent, which is huge.",
          item_id: itemId(2),
        };
        return good;
      },
      () => "It cuts latency by 85 percent.",
    );
    const result = await run(input, writer);
    expect(writer.rewrites).toHaveLength(1);
    expect(writer.rewrites[0]?.story?.item_id).toBe(itemId(2));
    expect(writer.rewrites[0]?.problem).toMatch(/90/);
    expect(result.dropped_turns).toBe(1);
    const spoken = result.turns.map((t) => t.text).join(" ");
    expect(spoken).not.toMatch(/90|85/);
    // The story's other turn, with a number that is in the story, stays.
    expect(result.turns.some((t) => t.item_id === itemId(2))).toBe(false);
    expect(result.turns.some((t) => t.item_id === itemId(1))).toBe(true);
  });

  it("keeps a turn that the single rewrite repairs", async () => {
    const input = inputFor("readout", 10, 3);
    const writer = new FakeScriptWriter(
      (i) => {
        const good = scriptOf(i);
        good.turns[1] = {
          speaker: "a",
          text: "It cuts latency by 90 percent.",
          item_id: itemId(1),
        };
        return good;
      },
      () => "It cuts latency by 40 percent.",
    );
    const result = await run(input, writer);
    expect(result.rewritten).toBe(1);
    expect(result.dropped_turns).toBe(0);
    expect(result.turns[1]?.text).toBe("It cuts latency by 40 percent.");
  });

  it("accepts a number that is in the story", async () => {
    const input = inputFor("readout", 10, 3);
    const writer = new FakeScriptWriter((i) => {
      const good = scriptOf(i);
      good.turns[1] = {
        speaker: "a",
        text: "It cuts latency by 40 percent.",
        item_id: itemId(1),
      };
      return good;
    });
    const result = await run(input, writer);
    expect(writer.rewrites).toHaveLength(0);
    expect(result.turns[1]?.text).toContain("40 percent");
  });

  it("checks a number against its own story, not another one", async () => {
    const base = inputFor("readout", 10, 3);
    const input = {
      ...base,
      stories: base.stories.map((story, i) =>
        i === 1
          ? {
              ...story,
              summary: "Example Wire reports a launch priced at 700 dollars. It ships in spring.",
            }
          : story,
      ),
    };
    const writer = new FakeScriptWriter((i) => {
      const good = scriptOf(i);
      good.turns[1] = { speaker: "a", text: "It costs 700 dollars.", item_id: itemId(1) };
      return good;
    });
    const result = await run(input, writer);
    expect(writer.rewrites).toHaveLength(1);
    expect(result.turns.some((t) => t.text.includes("700"))).toBe(false);
  });

  it("names the show again when the checks drop the opening", async () => {
    const input = inputFor("readout", 10, 3);
    const writer = new FakeScriptWriter((i) => {
      const good = scriptOf(i);
      good.turns[0] = { speaker: "a", text: "Welcome to Singularity, episode 777." };
      return good;
    });
    const result = await run(input, writer);
    expect(result.turns[0]?.text).toBe("This is Singularity.");
    expect(result.turns.map((t) => t.text).join(" ")).not.toMatch(/777/);
  });
});
