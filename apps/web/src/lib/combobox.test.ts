import { describe, expect, it } from "vitest";
import { writerOptions } from "./combobox";
import { NEBIUS_TOP } from "./modelId";

const TOP_IDS = NEBIUS_TOP.map((model) => model.id);
const ids = (options: ReturnType<typeof writerOptions>, group: string) =>
  options.filter((option) => option.group === group).map((option) => option.id);

// Anthropic's list, newest first, with two Sonnets and a model released after the built-in ones.
const CLAUDE = [
  { id: "claude-opus-6", label: "Claude Opus 6" },
  { id: "claude-sonnet-6", label: "Claude Sonnet 6" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

// Nebius's list with two of the curated models and others between them.
const NEBIUS = [
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", context_length: 262144 },
  { id: "moonshotai/Kimi-K3", context_length: 1048576 },
  { id: "openai/gpt-oss-120b", context_length: 131072 },
  { id: "zai-org/GLM-5.3", context_length: 1048576 },
];

describe("writerOptions", () => {
  // Bug it prevents: a newer Opus, Sonnet or Haiku exists but the select keeps offering the old one.
  it("offers the newest Opus, Sonnet and Haiku Anthropic lists, in that order", () => {
    expect(ids(writerOptions(null, CLAUDE, NEBIUS), "Claude")).toEqual([
      "claude-opus-6",
      "claude-sonnet-6",
      "claude-haiku-5-5",
    ]);
  });

  // Bug it prevents: no Claude model to pick while Anthropic's list is down or lacks a family.
  it("falls back to the built-in model of a family the list cannot give", () => {
    expect(ids(writerOptions(null), "Claude")).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    const noOpus = CLAUDE.filter((model) => !model.id.includes("opus"));
    expect(ids(writerOptions(null, noOpus), "Claude")[0]).toBe("claude-opus-5-5");
  });

  // Bug it prevents: a retired Nebius model offered, or more than five crowding the select.
  it("offers the first five curated Nebius models the live list still serves", () => {
    expect(ids(writerOptions(null, null, NEBIUS), "Nebius")).toEqual([
      "zai-org/GLM-5.3",
      "moonshotai/Kimi-K3",
    ]);
    const all = TOP_IDS.map((id) => ({ id, context_length: null }));
    expect(ids(writerOptions(null, null, all), "Nebius")).toEqual(TOP_IDS.slice(0, 5));
  });

  // Bug it prevents: no Nebius model to pick while Nebius's list cannot be read.
  it("offers the first five curated models without a live list", () => {
    expect(ids(writerOptions(null), "Nebius")).toEqual(TOP_IDS.slice(0, 5));
  });

  // Bug it prevents: opening the page quietly swaps a saved choice for the first option.
  it("keeps a saved model that is not offered, flagged, and does not repeat one that is", () => {
    for (const saved of ["old/Gone-7B", "moonshotai/Kimi-K2.6", "claude-sonnet-5-5"]) {
      const options = writerOptions(saved, CLAUDE, NEBIUS);
      expect(options.filter((option) => option.id === saved)).toHaveLength(1);
    }
    const current = writerOptions("old/Gone-7B", CLAUDE, NEBIUS).at(-1);
    expect(current).toEqual({ id: "old/Gone-7B", label: "Gone-7B (current)", group: "" });
    expect(writerOptions("claude-sonnet-5-5", CLAUDE, NEBIUS).at(-1)).toMatchObject({
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5 (current)",
    });
    expect(writerOptions("zai-org/GLM-5.3", CLAUDE, NEBIUS).at(-1)?.group).toBe("Nebius");
  });
});
