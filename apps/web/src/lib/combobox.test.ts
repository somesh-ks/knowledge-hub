import { describe, expect, it } from "vitest";
import {
  CLAUDE_OPTIONS,
  countText,
  filterOptions,
  labelFor,
  moveIndex,
  nebiusOptions,
} from "./combobox";

const LIVE = [
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", context_length: 262144 },
  { id: "meta-llama/Llama-3.3-70B-Instruct", context_length: 131072 },
  { id: "BAAI/bge-multilingual-gemma2", context_length: 8192 },
  { id: "tiny/Model-1B", context_length: null },
];

describe("nebiusOptions", () => {
  it("starts with Automatic, then the recommended models, then the rest", () => {
    const options = nebiusOptions(LIVE, null);
    expect(options[0]).toMatchObject({ id: "", label: "Automatic", group: "" });
    const groups = options.slice(1).map((option) => option.group);
    expect(groups).toEqual([...groups].sort((a, b) => (a === b ? 0 : a === "rec" ? -1 : 1)));
    expect(
      options
        .slice(1)
        .map((o) => o.id)
        .sort(),
    ).toEqual(LIVE.map((e) => e.id).sort());
    expect(options.find((o) => o.id.includes("bge"))?.group).toBe("rest");
  });

  it("names a model by its last segment and hints its vendor and context", () => {
    const llama = nebiusOptions(LIVE, null).find((o) => o.id.startsWith("meta-llama"));
    expect(llama).toMatchObject({
      label: "Llama-3.3-70B-Instruct",
      hint: "meta-llama, 128k context",
    });
  });

  it("adds a saved model the list no longer has, and says so", () => {
    const gone = nebiusOptions(LIVE, "old/Gone-7B").find((o) => o.id === "old/Gone-7B");
    expect(gone?.hint).toContain("Not in the live list");
  });

  it("offers Automatic and the saved model only, without a live list", () => {
    expect(nebiusOptions(null, "a/b").map((o) => o.id)).toEqual(["", "a/b"]);
    expect(nebiusOptions(null, null).map((o) => o.id)).toEqual([""]);
  });
});

describe("Claude options", () => {
  it("are exactly Sonnet 5.5 and Haiku 5.5", () => {
    expect(CLAUDE_OPTIONS.map((o) => [o.id, o.label])).toEqual([
      ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
      ["claude-haiku-5-5", "Claude Haiku 5.5"],
    ]);
  });
});

describe("filterOptions", () => {
  const options = nebiusOptions(LIVE, null);
  it("keeps everything for an empty query", () => {
    expect(filterOptions(options, "  ")).toHaveLength(options.length);
  });
  it("matches name or id, ignoring case", () => {
    expect(filterOptions(options, "LLAMA").map((o) => o.id)).toEqual([
      "meta-llama/Llama-3.3-70B-Instruct",
    ]);
    expect(filterOptions(options, "baai").map((o) => o.id)).toEqual([
      "BAAI/bge-multilingual-gemma2",
    ]);
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
    expect(labelFor(nebiusOptions(LIVE, null), null)).toBe("Automatic");
    expect(labelFor([], "a/b")).toBe("b");
  });
  it("words the count", () => {
    expect(countText(0)).toBe("No models match");
    expect(countText(1)).toBe("1 model");
    expect(countText(4)).toBe("4 models");
  });
});
