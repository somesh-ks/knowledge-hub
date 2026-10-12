import { describe, expect, it } from "vitest";
import {
  CLAUDE_OPTIONS,
  countText,
  filterOptions,
  labelFor,
  moveIndex,
  nebiusOptions,
} from "./combobox";
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
  it("starts with Automatic, then the top models it serves in their order, then the rest", () => {
    expect(rows(nebiusOptions(LIVE, null))).toEqual([
      ["", ""],
      ["zai-org/GLM-5.3", "top"],
      ["moonshotai/Kimi-K3", "top"],
      ["Qwen/Qwen3-235B-A22B-Instruct-2507", "rest"],
      ["openai/gpt-oss-120b", "rest"],
    ]);
    expect(nebiusOptions(LIVE, null)[0]).toMatchObject({ label: "Default" });
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
    expect(rows(options)[3]).toEqual(["old/Gone-7B", "rest"]);
    expect(options[3]?.hint).toBe("Not in the live list");
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
      expect(nebiusOptions(LIVE, saved)).toHaveLength(5);
    }
  });

  it("lets the ranking fill the top models when it serves none of them", () => {
    const options = nebiusOptions(OLD, null);
    const top = options.filter((o) => o.group === "top").map((o) => o.id);
    expect(top).toEqual(shortlist(OLD));
    expect(options.find((o) => o.id.includes("bge"))?.group).toBe("rest");
    expect(options).toHaveLength(OLD.length + 1);
  });
});

describe("nebiusOptions without the live list", () => {
  it("offers Automatic and every top model by name alone", () => {
    const options = nebiusOptions(null, null);
    expect(rows(options)).toEqual([["", ""], ...TOP_IDS.map((id) => [id, "top"])]);
    expect(options.slice(1).map((o) => o.label)).toEqual(NEBIUS_TOP.map((m) => m.label));
    expect(options.find((o) => o.id === "zai-org/GLM-5.3")?.hint).toBe("");
  });

  it("keeps a saved model that is not a top model, right under Automatic", () => {
    const options = nebiusOptions(null, "acme/Fast-1");
    expect(rows(options).slice(0, 3)).toEqual([
      ["", ""],
      ["acme/Fast-1", ""],
      [TOP_IDS[0], "top"],
    ]);
    expect(options[1]).toMatchObject({ label: "Fast-1", hint: "" });
  });

  it("does not repeat a saved top model", () => {
    const options = nebiusOptions(null, "zai-org/GLM-5.3");
    expect(options).toHaveLength(TOP_IDS.length + 1);
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

describe("filterOptions", () => {
  const options = nebiusOptions(LIVE, null);
  it("keeps everything for an empty query", () => {
    expect(filterOptions(options, "  ")).toHaveLength(options.length);
  });
  it("matches name or id, ignoring case", () => {
    expect(filterOptions(options, "OSS").map((o) => o.id)).toEqual(["openai/gpt-oss-120b"]);
    expect(filterOptions(options, "kimi k3").map((o) => o.id)).toEqual(["moonshotai/Kimi-K3"]);
    expect(filterOptions(options, "zai-org").map((o) => o.id)).toEqual(["zai-org/GLM-5.3"]);
    expect(filterOptions(options, "zzz")).toEqual([]);
  });
});

describe("moveIndex", () => {
  it("wraps the arrows and jumps with Home and End", () => {
    expect(moveIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(moveIndex(2, 3, "ArrowDown")).toBe(0);
    expect(moveIndex(1, 3, "ArrowDown")).toBe(2);
    expect(moveIndex(-1, 3, "ArrowUp")).toBe(2);
    expect(moveIndex(0, 3, "ArrowUp")).toBe(2);
    expect(moveIndex(2, 3, "ArrowUp")).toBe(1);
    expect(moveIndex(1, 3, "Home")).toBe(0);
    expect(moveIndex(0, 3, "End")).toBe(2);
  });
  it("has no highlight in an empty list and ignores other keys", () => {
    expect(moveIndex(0, 0, "ArrowDown")).toBe(-1);
    expect(moveIndex(1, 3, "a")).toBe(1);
  });
});

describe("labelFor and countText", () => {
  it("labels a chosen model", () => {
    expect(labelFor(CLAUDE_OPTIONS, "claude-haiku-5-5")).toBe("Claude Haiku 5.5");
    expect(labelFor(nebiusOptions(LIVE, null), null)).toBe("Default");
    expect(labelFor(nebiusOptions(LIVE, null), "moonshotai/Kimi-K3")).toBe("Kimi K3");
    expect(labelFor([], "a/b")).toBe("b");
    expect(labelFor([], "zai-org/GLM-5.3")).toBe("GLM-5.3");
  });
  it("words the count", () => {
    expect(countText(0)).toBe("No models match");
    expect(countText(1)).toBe("1 model");
    expect(countText(4)).toBe("4 models");
  });
});
