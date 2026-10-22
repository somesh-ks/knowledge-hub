import { ConfigOpBatch, parseConfigOps } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { clusterStories } from "../src/dedupe/storyCluster.js";
import { scriptSystemPrompt } from "../src/podcast/prompt.js";
import { matchesRequest } from "../src/podcast/select.js";
import { coverageFactor } from "../src/score/scoreTopics.js";
import { makeItem } from "./fetch-helpers.js";
import { REQUEST } from "./podcast-fixtures.js";

const at = (h: number) => new Date(Date.UTC(2026, 9, 7, 0) + h * 3_600_000).toISOString();
const news = (src: string, title: string, h = 0) =>
  makeItem({
    url: `https://${src}.example/${encodeURIComponent(title)}`,
    title,
    source_id: src,
    published_at: at(h),
  });

describe("news clustering", () => {
  const run = (items: ReturnType<typeof news>[]) =>
    clusterStories({
      profile: "news",
      items,
      eligible: () => true,
      compare: (a, b) => a.id.localeCompare(b.id),
      absorb: (keep) => keep,
    });
  it("counts distinct outlets on one story", () => {
    const r = run([
      news("npr", "Senate passes sweeping Ukraine aid bill"),
      news("cbs", "Senate approves Ukraine aid bill", 3),
      news("sky", "Senate clears Ukraine aid bill in vote", 5),
      news("abc", "Wildfire forces thousands to flee California town"),
    ]);
    const ukraine = r.items.find((i) => /Ukraine/.test(i.title));
    expect(ukraine?.signals.coverage).toBe(3);
    expect(r.items.find((i) => /Wildfire/.test(i.title))?.signals.coverage).toBeUndefined();
  });
  it("does not join stories more than 48 hours apart", () => {
    const r = run([
      news("npr", "Senate passes Ukraine aid bill"),
      news("cbs", "Senate passes Ukraine aid bill again", 60),
    ]);
    expect(r.items).toHaveLength(2);
  });
  it("one outlet never counts as coverage", () => {
    expect(coverageFactor(undefined)).toBe(0);
    expect(coverageFactor(1)).toBe(0);
    expect(coverageFactor(2)).toBeGreaterThan(0.5);
    expect(coverageFactor(9)).toBe(1);
  });
});

describe("podcast", () => {
  it("always includes top picks", () => {
    const ids = new Set(["ai"]);
    expect(matchesRequest({ section: "top", category: "x" }, ids)).toBe(true);
    expect(matchesRequest({ section: "design", category: "x" }, ids)).toBe(false);
    expect(matchesRequest({ section: "design", category: "x" }, new Set(["design"]))).toBe(true);
  });
  it("writes differently for a general audience", () => {
    const base = { stories: [], budget_chars: 3000 };
    const custom = scriptSystemPrompt({ ...base, request: REQUEST });
    const general = scriptSystemPrompt({ ...base, request: { ...REQUEST, audience: "general" } });
    expect(custom).not.toContain("AUDIENCE");
    expect(general).toContain("Explain any technical term");
  });
});

describe("config op batches", () => {
  const topic = { op: "topic.upsert", topic: { name: "Quantum", description: "qubits" } };
  const src = { op: "source.add", url: "https://a.example/", topic_ids: ["quantum"] };
  it("accepts one op or 1 to 8", () => {
    expect(parseConfigOps(topic)).toMatchObject({ success: true });
    const many = parseConfigOps([topic, src]);
    expect(many.success && many.data.map((o) => o.op)).toEqual(["topic.upsert", "source.add"]);
    expect(ConfigOpBatch.safeParse(topic).success).toBe(true);
  });
  it("rejects nine ops, none, and a batch with one bad op", () => {
    expect(parseConfigOps(Array(9).fill(src)).success).toBe(false);
    expect(parseConfigOps([]).success).toBe(false);
    expect(parseConfigOps([topic, { op: "nope" }]).success).toBe(false);
  });
});
