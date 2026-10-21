import { describe, expect, it } from "vitest";
import { ModelRouting } from "./modelRouting.js";

const base = {
  version: 1,
  families: { "claude-sonnet": { fallback_id: "claude-sonnet-5-5" } },
  steps: { story_writer: { chain: [{ family: "claude-sonnet" }] } },
};

describe("model routing schema", () => {
  it("accepts an allowed family and defaults the timeout", () => {
    const parsed = ModelRouting.parse(base);
    expect(parsed.steps.story_writer?.chain[0]?.timeout_ms).toBe(120_000);
  });

  // A silent drift to Opus (cost), Gemini Pro or the removed Nebius would spend money or break a
  // run unseen, so the file itself must refuse them.
  it.each(["claude-opus", "gemini-pro", "nebius", "fable"])("rejects the family %s", (family) => {
    const steps = { story_writer: { chain: [{ family }] } };
    expect(ModelRouting.safeParse({ ...base, steps }).success).toBe(false);
    const families = { [family]: { fallback_id: "x" } };
    expect(ModelRouting.safeParse({ ...base, families }).success).toBe(false);
  });
});
