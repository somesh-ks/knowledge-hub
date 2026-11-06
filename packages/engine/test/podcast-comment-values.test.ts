import { describe, expect, it } from "vitest";
import type { ApiReply } from "../src/llm/providers.js";
import { CommentValuesReader } from "../src/podcast/commentHints.js";

const reply = (json: unknown, stopReason: ApiReply["stopReason"] = "end"): ApiReply => ({
  text: typeof json === "string" ? json : JSON.stringify(json),
  stopReason,
  inputTokens: 0,
  outputTokens: 0,
});
const reader = (answer: ApiReply | Error, failures: string[] = []) =>
  new CommentValuesReader({
    api: {
      provider: "anthropic",
      call: async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    onFailure: (reason) => failures.push(reason),
  });
const names = ["AI", "Business news"];

describe("CommentValuesReader (D371)", () => {
  // The bug it prevents: a category the model made up, or one spelled differently, reaching the sheet.
  it("passes on only the steps and the category names that were sent", async () => {
    const read = await reader(
      reply({ length: "longer", stories: "more", add: ["business news", "Startups", "AI", "ai"] }),
    ).read("more on business", names);
    expect(read).toEqual({ length: "longer", stories: "more", add: ["Business news", "AI"] });
  });

  it("answers no length and no count for 'same'", async () => {
    const same = reply({ length: "same", stories: "same", add: [] });
    expect(await reader(same).read("fine", names)).toEqual({
      length: null,
      stories: null,
      add: [],
    });
  });

  // The bug it prevents: a broken model stalling the sheet, which carries on with the word match.
  it("answers null, never throws, on a refusal, a bad reply or a failed call", async () => {
    const failures: string[] = [];
    expect(await reader(reply("", "refusal"), failures).read("x", names)).toBeNull();
    expect(
      await reader(reply({ length: "huge", stories: "same", add: [] }), failures).read("x", names),
    ).toBeNull();
    expect(await reader(new Error("down"), failures).read("x", names)).toBeNull();
    expect(failures).toHaveLength(2);
  });
});
