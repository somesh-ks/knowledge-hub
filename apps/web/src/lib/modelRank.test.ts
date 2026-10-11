import { describe, expect, it } from "vitest";
import { isRecommendable, shortlist, topModels } from "./modelRank";

const k = 1024;
// A list shaped like the live Nebius catalogue, after the API's own text-model filter.
const LIVE = [
  { id: "BAAI/bge-multilingual-gemma2", context_length: 8 * k },
  { id: "deepseek-ai/DeepSeek-R1-0528", context_length: 128 * k },
  { id: "deepseek-ai/DeepSeek-V3.2", context_length: 160 * k },
  { id: "google/gemma-3-27b-it", context_length: 128 * k },
  { id: "meta-llama/Llama-3.3-70B-Instruct", context_length: 128 * k },
  { id: "meta-llama/Llama-Guard-3-8B", context_length: 8 * k },
  { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", context_length: 128 * k },
  { id: "moonshotai/Kimi-K2-Instruct", context_length: 128 * k },
  { id: "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1", context_length: 128 * k },
  { id: "openai/gpt-oss-120b", context_length: 128 * k },
  { id: "openai/gpt-oss-20b", context_length: 128 * k },
  { id: "Qwen/Qwen2.5-VL-72B-Instruct", context_length: 32 * k },
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", context_length: 256 * k },
  { id: "Qwen/Qwen3-235B-A22B-Thinking-2507", context_length: 256 * k },
  { id: "Qwen/Qwen3-32B", context_length: 40 * k },
  { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", context_length: 256 * k },
  { id: "zai-org/GLM-4.5", context_length: 128 * k },
];

describe("isRecommendable", () => {
  it("leaves out embedding, guard, vision, coder and base models", () => {
    for (const id of [
      "BAAI/bge-multilingual-gemma2",
      "meta-llama/Llama-Guard-3-8B",
      "Qwen/Qwen2.5-VL-72B-Instruct",
      "Qwen/Qwen3-Coder-480B-A35B-Instruct",
      "meta-llama/Llama-3.1-405B-Base",
    ]) {
      expect(isRecommendable(id), id).toBe(false);
    }
    expect(isRecommendable("Qwen/Qwen3-32B")).toBe(true);
  });
});

describe("shortlist", () => {
  const picked = shortlist(LIVE);

  it("returns five models, none of them excluded kinds", () => {
    expect(picked).toHaveLength(5);
    for (const id of picked) expect(isRecommendable(id), id).toBe(true);
  });

  it("puts large current models first and small or old ones out", () => {
    expect(picked).toContain("deepseek-ai/DeepSeek-V3.2");
    expect(picked).toContain("Qwen/Qwen3-235B-A22B-Instruct-2507");
    expect(picked).toContain("moonshotai/Kimi-K2-Instruct");
    expect(picked).not.toContain("meta-llama/Meta-Llama-3.1-8B-Instruct");
    expect(picked).not.toContain("openai/gpt-oss-20b");
  });

  it("takes at most two from one vendor", () => {
    const qwen = picked.filter((id) => id.startsWith("Qwen/"));
    expect(qwen.length).toBeLessThanOrEqual(2);
  });

  it("is the same whatever order the list arrives in", () => {
    expect(shortlist([...LIVE].reverse())).toEqual(picked);
  });

  it("copes with a short or empty list", () => {
    expect(shortlist([])).toEqual([]);
    expect(shortlist([{ id: "acme/Chat-7B-Instruct", context_length: null }])).toEqual([
      "acme/Chat-7B-Instruct",
    ]);
  });
});

describe("topModels", () => {
  const CURATED = ["zai-org/GLM-5.3", "moonshotai/Kimi-K3", "deepseek-ai/DeepSeek-V4-Pro-0813"];

  it("offers every curated id, in order, without a live list", () => {
    expect(topModels(null, CURATED)).toEqual(CURATED);
  });

  it("keeps the curated ids the live list serves, in the curated order", () => {
    const live = [
      { id: "deepseek-ai/DeepSeek-V4-Pro-0813", context_length: 979 * k },
      { id: "openai/gpt-oss-120b", context_length: 128 * k },
      { id: "zai-org/GLM-5.3", context_length: 1024 * k },
    ];
    expect(topModels(live, CURATED)).toEqual([
      "zai-org/GLM-5.3",
      "deepseek-ai/DeepSeek-V4-Pro-0813",
    ]);
  });

  it("matches ids exactly, so an id offered is one Nebius lists as spelled", () => {
    const live = [
      { id: "zai-org/glm-5.3", context_length: null },
      { id: "moonshotai/Kimi-K3", context_length: null },
    ];
    expect(topModels(live, CURATED)).toEqual(["moonshotai/Kimi-K3"]);
  });

  it("falls back to the shortlist when no curated id is left", () => {
    expect(topModels(LIVE, CURATED)).toEqual(shortlist(LIVE));
    expect(topModels(LIVE, [])).toEqual(shortlist(LIVE));
  });

  it("is empty only when the live list is", () => {
    expect(topModels([], CURATED)).toEqual([]);
  });

  it("hands out a copy, never the curated list itself", () => {
    const offered = topModels(null, CURATED);
    offered.pop();
    expect(CURATED).toHaveLength(3);
  });
});
