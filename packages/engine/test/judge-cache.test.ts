import {
  EMPTY_JUDGMENTS,
  type Item,
  type JudgmentEntry,
  type JudgmentsFile,
} from "@singularity/core";
import { describe, expect, it } from "vitest";
import {
  judgeWithCache,
  judgmentKey,
  lookupJudgments,
  mergeJudgments,
  pruneJudgments,
} from "../src/judge/cache.js";
import { FallbackJudge } from "../src/judge/fallbackJudge.js";
import type { Judge } from "../src/judge/types.js";
import { makeEntry, makeItem } from "./score-factories.js";
import { captureLog } from "./write-fakes.js";

const MODEL = "jev-test";
const HASH = "abc123def456";

/** A judge that answers from a script and records what it was asked. */
function stubJudge(options: { model?: string; hash?: string; skip?: Set<string> } = {}): Judge & {
  asked: string[][];
} {
  const asked: string[][] = [];
  return {
    asked,
    name: "stub",
    model: options.model ?? MODEL,
    questionsHash: options.hash ?? HASH,
    async judge(items: Item[]): Promise<JudgmentEntry[]> {
      asked.push(items.map((i) => i.id));
      return items
        .filter((i) => !options.skip?.has(i.id))
        .map((i) => ({
          ...makeEntry(i, { model: options.model ?? MODEL }),
          questions_hash: options.hash ?? HASH,
        }));
    },
  };
}

const cacheOf = (...entries: JudgmentEntry[]): JudgmentsFile =>
  mergeJudgments(EMPTY_JUDGMENTS, entries);

describe("judgment cache keys", () => {
  it("joins item id, questions hash and model", () => {
    expect(judgmentKey("aaaaaaaaaaaa", HASH, MODEL)).toBe(`aaaaaaaaaaaa:${HASH}:${MODEL}`);
  });

  it("separates hits from misses by questions hash and model", () => {
    const [a, b, c] = [makeItem(), makeItem(), makeItem()];
    const cache = cacheOf(
      { ...makeEntry(a, { model: MODEL }), questions_hash: HASH },
      { ...makeEntry(b, { model: "other-model" }), questions_hash: HASH },
      { ...makeEntry(c, { model: MODEL }), questions_hash: "stale0000000" },
    );
    const { hits, misses } = lookupJudgments(cache, [a, b, c], {
      model: MODEL,
      questionsHash: HASH,
    });
    expect(hits.map((h) => h.item_id)).toEqual([a.id]);
    expect(misses.map((m) => m.id)).toEqual([b.id, c.id]);
  });
});

describe("mergeJudgments and pruneJudgments", () => {
  it("adds entries without touching the original or other keys", () => {
    const a = makeItem();
    const original = cacheOf({ ...makeEntry(a), questions_hash: HASH });
    const b = makeItem();
    const merged = mergeJudgments(original, [{ ...makeEntry(b), questions_hash: HASH }]);
    expect(Object.keys(original.entries)).toHaveLength(1);
    expect(Object.keys(merged.entries)).toHaveLength(2);
    expect(merged.version).toBe(1);
  });

  it("replaces an entry with the same key", () => {
    const a = makeItem();
    const first = { ...makeEntry(a, { depth: 0.2 }), questions_hash: HASH };
    const second = { ...makeEntry(a, { depth: 0.9 }), questions_hash: HASH };
    const merged = mergeJudgments(cacheOf(first), [second]);
    expect(Object.values(merged.entries)).toHaveLength(1);
    expect(Object.values(merged.entries)[0]?.craft_depth).toBe(0.9);
  });

  it("prunes entries older than 30 days", () => {
    const fresh = makeItem();
    const stale = makeItem();
    const cache = cacheOf(
      { ...makeEntry(fresh, { judgedAt: "2026-10-01T00:00:00Z" }), questions_hash: HASH },
      { ...makeEntry(stale, { judgedAt: "2026-08-01T00:00:00Z" }), questions_hash: HASH },
    );
    const pruned = pruneJudgments(cache, new Date("2026-10-06T00:00:00Z"));
    expect(Object.values(pruned.entries).map((e) => e.item_id)).toEqual([fresh.id]);
  });
});

describe("judgeWithCache", () => {
  it("asks the judge only about items the cache lacks", async () => {
    const [a, b, c] = [makeItem(), makeItem(), makeItem()];
    const cache = cacheOf({ ...makeEntry(a, { model: MODEL }), questions_hash: HASH });
    const judge = stubJudge();
    const result = await judgeWithCache(judge, [a, b, c], cache);
    expect(judge.asked).toEqual([[b.id, c.id]]);
    expect(result.hitCount).toBe(1);
    expect(result.missCount).toBe(2);
    expect(result.entries.map((e) => e.item_id)).toEqual([a.id, b.id, c.id]);
    expect(Object.keys(result.cache.entries)).toHaveLength(3);
  });

  it("makes no call when everything is cached", async () => {
    const a = makeItem();
    const cache = cacheOf({ ...makeEntry(a, { model: MODEL }), questions_hash: HASH });
    const judge = stubJudge();
    const result = await judgeWithCache(judge, [a], cache);
    expect(judge.asked).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it("re-judges when the model changes", async () => {
    const a = makeItem();
    const cache = cacheOf({ ...makeEntry(a, { model: "jev-old" }), questions_hash: HASH });
    const judge = stubJudge({ model: "jev-new" });
    await judgeWithCache(judge, [a], cache);
    expect(judge.asked).toEqual([[a.id]]);
  });

  it("reports items the judge could not answer", async () => {
    const [a, b] = [makeItem(), makeItem()];
    const result = await judgeWithCache(
      stubJudge({ skip: new Set([b.id]) }),
      [a, b],
      EMPTY_JUDGMENTS,
    );
    expect(result.entries.map((e) => e.item_id)).toEqual([a.id]);
    expect(result.unjudged).toEqual([b.id]);
  });
});

describe("FallbackJudge", () => {
  it("does not call the fallback when the primary answers everything", async () => {
    const primary = stubJudge();
    const fallback = stubJudge({ model: "nebius:x" });
    const items = [makeItem(), makeItem()];
    const entries = await new FallbackJudge(primary, fallback).judge(items);
    expect(entries).toHaveLength(2);
    expect(fallback.asked).toEqual([]);
  });

  it("hands unanswered items to the fallback, logs it, and keeps input order", async () => {
    const [a, b, c] = [makeItem(), makeItem(), makeItem()];
    const primary = stubJudge({ skip: new Set([b.id]) });
    const fallback = stubJudge({ model: "nebius:x", hash: "fallback0000" });
    const { log, lines } = captureLog();
    const judge = new FallbackJudge(primary, fallback, log);
    const entries = await judge.judge([a, b, c]);
    expect(fallback.asked).toEqual([[b.id]]);
    expect(entries.map((e) => e.item_id)).toEqual([a.id, b.id, c.id]);
    expect(entries.find((e) => e.item_id === b.id)?.model).toBe("nebius:x");
    expect(lines.some((l) => l.level === "warn" && l.message.includes("fallback judge"))).toBe(
      true,
    );
  });

  it("keys its cache by the primary so fallback answers are retried next run", () => {
    const judge = new FallbackJudge(
      stubJudge(),
      stubJudge({ model: "nebius:x", hash: "fallback0000" }),
    );
    expect(judge.model).toBe(MODEL);
    expect(judge.questionsHash).toBe(HASH);
  });
});
