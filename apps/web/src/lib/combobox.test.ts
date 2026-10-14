import { describe, expect, it } from "vitest";
import { CLAUDE_OPTIONS, claudeOptions, nebiusOptions } from "./combobox";
import { NEBIUS_TOP } from "./modelId";
import { shortlist } from "./modelRank";

// Shaped like the live list on 2026-10-11: two top models and two others, sorted by id.
const LIVE = [
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", context_length: 262144 },
  { id: "moonshotai/Kimi-K3", context_length: 1048576 },
  { id: "openai/gpt-oss-120b", context_length: 131072 },
  { id: "zai-org/GLM-5.3", context_length: 1048576 },
];

// A list from before every top model, for the fallback to the ranking.
const OLD = [
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", context_length: 262144 },
  { id: "meta-llama/Llama-3.3-70B-Instruct", context_length: 131072 },
  { id: "BAAI/bge-multilingual-gemma2", context_length: 8192 },
  { id: "tiny/Model-1B", context_length: null },
];

const TOP_IDS = NEBIUS_TOP.map((model) => model.id);
const rows = (options: ReturnType<typeof nebiusOptions>) =>
  options.map((option) => [option.id, option.group]);

describe("nebiusOptions with the live list", () => {
  it("starts with the top models it serves in their order, then the rest", () => {
    expect(rows(nebiusOptions(LIVE, null))).toEqual([
      ["zai-org/GLM-5.3", "top"],
      ["moonshotai/Kimi-K3", "top"],
      ["Qwen/Qwen3-235B-A22B-Instruct-2507", "rest"],
      ["openai/gpt-oss-120b", "rest"],
    ]);
  });

  it("leaves out a top model the live list no longer serves", () => {
    const ids = nebiusOptions(LIVE, null).map((option) => option.id);
    for (const gone of TOP_IDS.filter((id) => !LIVE.some((entry) => entry.id === id))) {
      expect(ids, gone).not.toContain(gone);
    }
  });

  // The vendor's prefix is part of the model's id, and the id is never shown.
  it("names a top model by its short name, any other by its last segment, and shows no id", () => {
    const options = nebiusOptions(LIVE, null);
    expect(options.find((o) => o.id === "moonshotai/Kimi-K3")).toMatchObject({
      label: "Kimi K3",
      hint: "1024k context",
    });
    expect(options.find((o) => o.id === "openai/gpt-oss-120b")).toMatchObject({
      label: "gpt-oss-120b",
      hint: "128k context",
    });
  });

  it("adds a saved model the list no longer has first among the rest, and says so", () => {
    const options = nebiusOptions(LIVE, "old/Gone-7B");
    expect(rows(options)[2]).toEqual(["old/Gone-7B", "rest"]);
    expect(options[2]?.hint).toBe("Not in the live list");
  });

  it("flags a saved top model that has been retired, under its short name", () => {
    const gone = nebiusOptions(LIVE, "moonshotai/Kimi-K2.6").find(
      (o) => o.id === "moonshotai/Kimi-K2.6",
    );
    expect(gone).toMatchObject({
      label: "Kimi K2.6",
      hint: "Not in the live list",
      group: "rest",
    });
  });

  it("does not repeat a saved model that is listed", () => {
    for (const saved of ["zai-org/GLM-5.3", "openai/gpt-oss-120b"]) {
      expect(nebiusOptions(LIVE, saved)).toHaveLength(4);
    }
  });

  it("lets the ranking fill the top models when it serves none of them", () => {
    const options = nebiusOptions(OLD, null);
    const top = options.filter((o) => o.group === "top").map((o) => o.id);
    expect(top).toEqual(shortlist(OLD));
    expect(options.find((o) => o.id.includes("bge"))?.group).toBe("rest");
    expect(options).toHaveLength(OLD.length);
  });
});

describe("nebiusOptions without the live list", () => {
  it("offers every top model by name alone", () => {
    const options = nebiusOptions(null, null);
    expect(rows(options)).toEqual(TOP_IDS.map((id) => [id, "top"]));
    expect(options.map((o) => o.label)).toEqual(NEBIUS_TOP.map((m) => m.label));
    expect(options.find((o) => o.id === "zai-org/GLM-5.3")?.hint).toBe("");
  });

  it("keeps a saved model that is not a top model, first", () => {
    const options = nebiusOptions(null, "acme/Fast-1");
    expect(rows(options).slice(0, 2)).toEqual([
      ["acme/Fast-1", ""],
      [TOP_IDS[0], "top"],
    ]);
    expect(options[0]).toMatchObject({ label: "Fast-1", hint: "" });
  });

  it("does not repeat a saved top model", () => {
    const options = nebiusOptions(null, "zai-org/GLM-5.3");
    expect(options).toHaveLength(TOP_IDS.length);
    expect(options.filter((o) => o.id === "zai-org/GLM-5.3")).toHaveLength(1);
  });
});

describe("the top models", () => {
  it("are five to eight distinct ids, each with its own name", () => {
    expect(TOP_IDS.length).toBeGreaterThanOrEqual(5);
    expect(TOP_IDS.length).toBeLessThanOrEqual(8);
    expect(new Set(TOP_IDS).size).toBe(TOP_IDS.length);
    const labels = NEBIUS_TOP.map((model) => model.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.trim()).not.toBe("");
  });
});

describe("claudeOptions", () => {
  it("keeps a chosen model that is not a Claude model, so a saved id is not changed on save", () => {
    expect(claudeOptions("claude-haiku-5-5")).toEqual([...CLAUDE_OPTIONS]);
    expect(claudeOptions("some/Old-Model").map((o) => o.id)).toEqual([
      ...CLAUDE_OPTIONS.map((o) => o.id),
      "some/Old-Model",
    ]);
  });
});
