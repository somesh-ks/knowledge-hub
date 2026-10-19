import { describe, expect, it } from "vitest";
import { ConfigOp, MAX_KEYWORDS, parseConfigOps, SOURCE_NAME_MAX } from "./index.js";

describe("ConfigOp: source.update", () => {
  it("takes a name, topics or both", () => {
    const ops = [
      { op: "source.update", id: "blog", name: "Blog" },
      { op: "source.update", id: "blog", topic_ids: ["quantum", "design_engineering_craft"] },
      { op: "source.update", id: "blog", name: "Blog", topic_ids: ["quantum"] },
      { op: "source.update", id: "blog", topic_ids: [] },
    ];
    for (const op of ops) expect(ConfigOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
  });

  it("trims the name", () => {
    expect(ConfigOp.parse({ op: "source.update", id: "blog", name: "  The Blog " })).toEqual({
      op: "source.update",
      id: "blog",
      name: "The Blog",
    });
  });

  it(`holds the name to 1 to ${SOURCE_NAME_MAX} characters and the topics to ${MAX_KEYWORDS}`, () => {
    const parse = (change: Record<string, unknown>) =>
      ConfigOp.safeParse({ op: "source.update", id: "blog", ...change }).success;
    expect(SOURCE_NAME_MAX).toBe(80);
    expect(parse({ name: "n".repeat(80) })).toBe(true);
    expect(parse({ name: "n".repeat(81) })).toBe(false);
    expect(parse({ name: "" })).toBe(false);
    expect(parse({ name: "   " })).toBe(false);
    expect(parse({ name: 7 })).toBe(false);
    const topics = (n: number) => Array.from({ length: n }, (_, i) => `topic_${i}`);
    expect(parse({ topic_ids: topics(MAX_KEYWORDS) })).toBe(true);
    expect(parse({ topic_ids: topics(MAX_KEYWORDS + 1) })).toBe(false);
    expect(parse({ topic_ids: ["Has Capitals"] })).toBe(false);
    expect(parse({ topic_ids: "quantum" })).toBe(false);
  });

  it("refuses an op that changes nothing, or names no source", () => {
    expect(ConfigOp.safeParse({ op: "source.update", id: "blog" }).success).toBe(false);
    expect(ConfigOp.safeParse({ op: "source.update", id: "", name: "Blog" }).success).toBe(false);
    expect(ConfigOp.safeParse({ op: "source.update", name: "Blog" }).success).toBe(false);
    const parsed = parseConfigOps({ op: "source.update", id: "blog" });
    expect(parsed).toMatchObject({
      success: false,
      issues: [{ message: "set name, topic_ids, format or any of them" }],
    });
  });

  it("travels in a batch with the other ops", () => {
    const parsed = parseConfigOps([
      { op: "source.set", id: "blog", pinned: true },
      { op: "source.update", id: "blog", name: "Blog", topic_ids: ["quantum"] },
    ]);
    expect(parsed.success).toBe(true);
  });
});
