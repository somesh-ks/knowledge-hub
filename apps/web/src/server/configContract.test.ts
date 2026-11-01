import { CATEGORIES, MAX_KEYWORDS, TopicInput, TopicsFile } from "@singularity/core";
import { applyOpsToDocuments } from "@singularity/engine/config-store";
import { describe, expect, it } from "vitest";
import { parseConfigOp } from "./configEdit";

/**
 * The class of bug behind "an edit the page sends is dropped or refused further down": every layer
 * keeps its own list of fields and its own limits (REL-11 the emoji, CFG-02 the line break, CFG-03 a
 * 45-character source id). Keys are read from core's schema, so a new field is red here until the
 * parser, the op and the writer carry it, or it is listed in DELIBERATE_DROPS with a reason.
 */

/** Fields the page never sends and the parser does not take; the op applies core's defaults. */
const DELIBERATE_DROPS: Record<string, string> = {
  never_publish: "set by the CLI only; an edit keeps the stored value or the default",
  depth: "set by the CLI only",
  section_title: "a new topic's section is titled after it",
  origin: "a topic made from the page is always custom",
};

const LONG_ID = `a${"b".repeat(63)}`;
/** One value per TopicInput key, each at core's limit. */
const SAMPLE: Record<string, unknown> = {
  id: LONG_ID,
  name: "n".repeat(60),
  description: `${"d".repeat(199)}\n${"e".repeat(200)}`,
  enabled: true,
  keywords: Array.from(
    { length: MAX_KEYWORDS },
    (_, i) => `${String(i).padStart(2, "0")}${"k".repeat(58)}`,
  ),
  section_id: LONG_ID,
  emoji: "🧪",
};

const PREFERENCES = JSON.stringify({
  profile: "",
  focus: "",
  weights: Object.fromEntries(CATEGORIES.map((category) => [category, 0.5])),
  preferred_keywords: [],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
});

describe("a topic edit at core's limits", () => {
  it("has a decision for every field core's schema has", () => {
    const keys = Object.keys(TopicInput.shape).sort();
    expect(keys).toEqual([...Object.keys(SAMPLE), ...Object.keys(DELIBERATE_DROPS)].sort());
  });

  it("goes through the parser and the op into topics.json with every field intact", async () => {
    const parsed = parseConfigOp({ op: "topic.upsert", topic: SAMPLE });
    expect(parsed, "the parser refused a topic that core accepts").not.toBeNull();
    const result = await applyOpsToDocuments({
      ops: parsed,
      documents: [{ path: "config/preferences.json", content: PREFERENCES, version: 1 }],
      baseFiles: { "config/sources.json": JSON.stringify({ version: 1, sources: [] }) },
    });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;
    const stored = TopicsFile.parse(JSON.parse(result.documents["config/topics.json"] ?? "{}"));
    const topic = stored.topics.find((entry) => entry.id === LONG_ID);
    expect(topic).toBeDefined();
    for (const key of Object.keys(SAMPLE)) {
      expect(
        topic?.[key as keyof typeof topic],
        `${key} was lost on the way to topics.json`,
      ).toEqual(key === "description" ? String(SAMPLE.description).trim() : SAMPLE[key]);
    }
  });

  it("takes the ids and lists core takes, and refuses what core refuses", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `topic-${i}`);
    const add = (extra: object) =>
      parseConfigOp({ op: "source.add", url: "https://example.com/feed", ...extra });
    expect(add({ id: LONG_ID, topic_ids: ids(MAX_KEYWORDS) })).not.toBeNull();
    expect(add({ topic_ids: ids(MAX_KEYWORDS + 1) })).toBeNull();
    expect(parseConfigOp({ op: "topic.scope", ids: ids(50), daily: true })).not.toBeNull();
    expect(parseConfigOp({ op: "topic.scope", ids: ids(51), daily: true })).toBeNull();
  });
});
