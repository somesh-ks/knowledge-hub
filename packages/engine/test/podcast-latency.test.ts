import type { PodcastRequest } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  planPodcast,
  reachableChars,
  scriptAcceptChars,
  scriptFloorChars,
} from "../src/podcast/plan.js";
import { scriptSystemPrompt, scriptUserMessage } from "../src/podcast/prompt.js";
import {
  closestId,
  generateScript,
  SCRIPT_TIME_LIMIT_MS,
  validateReply,
} from "../src/podcast/script.js";
import type { PodcastStory, ScriptInput, ScriptTurn } from "../src/podcast/types.js";
import { FakeScriptWriter, itemId, REQUEST, scriptOf } from "./podcast-fixtures.js";
import { captureLog } from "./write-fakes.js";

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

function inputOf(count = 4): ScriptInput {
  const request: PodcastRequest = { ...REQUEST, format: "readout", length_minutes: 5 };
  return { request, stories: storiesOf(count), budget_chars: planPodcast(request).budget_chars };
}

function charsOf(turns: readonly ScriptTurn[]): number {
  return turns.reduce((sum, turn) => sum + turn.text.length, 0);
}

/** A valid script whose kept length is exactly `target` characters. */
function scriptAt(input: ScriptInput, target: number): { turns: ScriptTurn[] } {
  const base = scriptOf(input, "");
  const validated = validateReply(base, input.request, input.stories);
  if (!validated.ok) throw new Error("the base script should be valid");
  const missing = target - charsOf(validated.turns);
  const turns = base.turns.map((turn) => ({ ...turn }));
  const story = turns.find((turn) => turn.item_id !== undefined);
  if (!story || missing < 2) throw new Error("the target is too small");
  story.text = `${story.text} ${"x".repeat(missing - 1)}`;
  return { turns };
}

const reachOf = (input: ScriptInput): number =>
  reachableChars(
    input.budget_chars,
    input.stories.length,
    input.request.format,
    input.request.length_minutes,
  );

describe("a first script a little under the floor", () => {
  it("is kept without a rewrite, and the run log says so", async () => {
    const input = inputOf();
    const reach = reachOf(input);
    const target = scriptAcceptChars(reach);
    expect(target).toBeLessThan(scriptFloorChars(reach));
    expect(target).toBe(Math.floor(scriptFloorChars(reach) * 0.95));
    const writer = new FakeScriptWriter(() => scriptAt(input, target));
    const { log, lines } = captureLog();
    const result = await generateScript({ ...input, writer, log });
    expect(writer.calls).toHaveLength(1);
    expect(result.writer_calls).toBe(1);
    const kept = lines.find((line) => line.message.startsWith("Kept a script a little under"));
    expect(kept?.data).toMatchObject({
      attempt: 1,
      chars: target,
      floor_chars: scriptFloorChars(reach),
      short_by_chars: scriptFloorChars(reach) - target,
    });
  });

  it("is still sent back when it falls further short than the grace", async () => {
    const input = inputOf();
    const reach = reachOf(input);
    const writer = new FakeScriptWriter((i, call) =>
      call === 0 ? scriptAt(input, scriptAcceptChars(reach) - 1) : scriptOf(i),
    );
    const result = await generateScript({ ...input, writer });
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[1]?.problems.join(" ")).toMatch(/too short by about/);
    expect(result.writer_calls).toBe(2);
  });

  it("asks for a length a typical reply lands above the floor at", () => {
    // Models deliver about 88 to 97 percent of what they are asked for.
    const input = inputOf(9);
    const reach = reachOf(input);
    const asked = Number(/Write about (\d+) words/.exec(scriptSystemPrompt(input, "B"))?.[1]);
    expect(asked * 0.88).toBeGreaterThan(scriptFloorChars(reach) / 6);
    expect(asked).toBeLessThanOrEqual(reach / 6);
  });
});

describe("the story id", () => {
  const known = new Set(["cef364b6dcb9", "a1b2c3d4e5f6", "a1b2c3d4ffff"]);

  it("is found inside an id that carries the marker around it", () => {
    expect(closestId("<<<SOURCE-0f0f0f0f0f0f0f0f cef364b6dcb9>>>", known)).toBe("cef364b6dcb9");
    expect(closestId("SOURCE-feedfacecafebeef a1b2c3d4ffff", known)).toBe("a1b2c3d4ffff");
    expect(closestId("id a1b2c3d4e5f6 and a1b2c3d4ffff", known)).toBe(
      "id a1b2c3d4e5f6 and a1b2c3d4ffff",
    );
  });

  it("is repaired in a reply, so the reply needs no rewrite", async () => {
    const input = inputOf();
    const writer = new FakeScriptWriter((i, call) => {
      const script = scriptOf(i);
      if (call > 0) return script;
      return {
        turns: script.turns.map((turn) =>
          turn.item_id
            ? { ...turn, item_id: `<<<SOURCE-0123456789abcdef ${turn.item_id}>>>` }
            : turn,
        ),
      };
    });
    const result = await generateScript({ ...input, writer });
    expect(writer.calls).toHaveLength(1);
    const ids = new Set(input.stories.map((story) => story.item_id));
    expect(
      result.turns.filter((turn) => turn.item_id).every((turn) => ids.has(turn.item_id ?? "")),
    ).toBe(true);
  });

  it("sits on its own line above the story block, not inside the marker", () => {
    const input = inputOf(2);
    const message = scriptUserMessage(input, "0123456789abcdef", []);
    const id = input.stories[0]?.item_id ?? "";
    expect(message).toContain(`\nitem_id: ${id}\n<<<SOURCE-0123456789abcdef story>>>\n`);
    expect(message).not.toMatch(new RegExp(`<<<SOURCE-[^>]*${id}`));
    expect(scriptSystemPrompt(input, "B")).toContain('copied exactly from the "item_id:" line');
  });
});

describe("the script time limit", () => {
  it("gives every call the deadline and starts no attempt after it", async () => {
    const input = inputOf();
    let clock = 1_000_000;
    const writer = new FakeScriptWriter((i) => {
      // Each call takes most of the limit.
      clock += SCRIPT_TIME_LIMIT_MS * 0.6;
      return scriptOf(i, "short.");
    });
    const { log, lines } = captureLog();
    const result = await generateScript({ ...input, writer, log, now: () => clock });
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[0]?.input.deadline_at).toBe(1_000_000 + SCRIPT_TIME_LIMIT_MS);
    expect(result.writer_calls).toBe(2);
    expect(result.short_by_chars).toBeGreaterThan(0);
    expect(lines.some((line) => line.message.includes("ran out of time"))).toBe(true);
  });

  it("fails as before when no usable reply came back in time", async () => {
    const input = inputOf();
    let clock = 0;
    const writer = new FakeScriptWriter(() => {
      clock += SCRIPT_TIME_LIMIT_MS;
      return { turns: [] };
    });
    await expect(generateScript({ ...input, writer, now: () => clock })).rejects.toThrow(
      /did not return a usable script/,
    );
    expect(writer.calls).toHaveLength(1);
  });
});
