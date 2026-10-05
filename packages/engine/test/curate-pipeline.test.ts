import { EMPTY_JUDGMENTS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { type CurateInput, curatePool } from "../src/curate/pipeline.js";
import { Selection, WrittenFile } from "../src/curate/selectionFile.js";
import { BudgetExceededError } from "../src/llm/errors.js";
import {
  FIXED_NOW,
  fakeWriter,
  goodSpecs,
  keywordGrounder,
  makeDeps,
  makePool,
  TableJudge,
} from "./curate-helpers.js";
import { realPreferences } from "./score-factories.js";

const WINDOW = { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" };

function input(items: CurateInput["pool"], overrides: Partial<CurateInput> = {}): CurateInput {
  return {
    pool: items,
    preferences: realPreferences(),
    judgments: EMPTY_JUDGMENTS,
    kind: "regular",
    window: WINDOW,
    ...overrides,
  };
}

describe("curatePool: the happy path", () => {
  it("judges, scores, selects, extracts, writes and validates", async () => {
    const { items, table } = makePool(goodSpecs(8));
    const judge = new TableJudge(table);
    const result = await curatePool(makeDeps({ judge }), input(items));
    expect(result.outcome).toBe("selected");
    expect(result.selection.items).toHaveLength(8);
    expect(result.selection.verified).toBe(true);
    expect(result.selection.mode).toBe("api");
    expect(result.selection.window).toEqual(WINDOW);
    expect(Selection.safeParse(result.selection).success).toBe(true);
    expect(WrittenFile.safeParse(result.written).success).toBe(true);
    expect(result.counts).toMatchObject({
      pool: 8,
      judged: 8,
      selected: 8,
      extracted: 8,
      written: 8,
      final: 8,
    });
    const first = result.selection.items[0];
    expect(first?.headline).toContain("retargets springs mid-flight");
  });

  it("orders selection items best first, so Top picks come first", async () => {
    const { items, table } = makePool(goodSpecs(8));
    const result = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    const scores = result.selection.items.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a).slice(0, 3)).toEqual(scores.slice(0, 3));
  });

  it("records how each item was produced, without source text", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const result = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    const entry = result.written.items[0];
    expect(entry).toMatchObject({
      extract_method: "content",
      verified: true,
      rewritten_fields: [],
    });
    expect(entry?.grounding.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(result.written)).not.toContain("Source text for");
  });

  it("returns the cache with the new judgments merged in", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const result = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    expect(Object.keys(result.judgments.entries)).toHaveLength(4);
  });

  it("serves cached judgments without calling the judge", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const judge = new TableJudge(table);
    const first = await curatePool(makeDeps({ judge }), input(items));
    const second = await curatePool(
      makeDeps({ judge }),
      input(items, { judgments: first.judgments }),
    );
    expect(judge.asked).toHaveLength(1);
    expect(second.counts.cacheHits).toBe(4);
    expect(second.outcome).toBe("selected");
  });
});

describe("curatePool: caps and kinds", () => {
  it("caps a regular digest at 12 and a weekly at 18", async () => {
    const { items, table } = makePool(goodSpecs(24));
    const regular = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    expect(regular.selection.items).toHaveLength(12);
    const weekly = await curatePool(
      makeDeps({ judge: new TableJudge(table) }),
      input(items, { kind: "weekly" }),
    );
    expect(weekly.selection.items).toHaveLength(18);
    expect(weekly.selection.kind).toBe("weekly");
  });
});

describe("curatePool: the nothing outcome", () => {
  it("publishes nothing when fewer than three items clear the bar, and never calls the writer", async () => {
    const { items, table } = makePool([
      ...goodSpecs(2),
      { category: "venture_capital_and_gossip", p: 0.9 },
      { category: "none" },
    ]);
    const writer = fakeWriter();
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items),
    );
    expect(result.outcome).toBe("nothing");
    expect(result.selection).toMatchObject({ outcome: "nothing", items: [], verified: false });
    expect(writer.materials).toEqual([]);
    expect(result.written.dropped.some((d) => d.stage === "select")).toBe(true);
  });

  it("falls to nothing when drops leave fewer than three", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const keep = new Set(items.slice(0, 2).map((i) => i.id));
    const result = await curatePool(
      makeDeps({
        judge: new TableJudge(table),
        extract: async (item) =>
          keep.has(item.id)
            ? { text: "Source text. ".repeat(100), method: "content", truncated: false }
            : null,
      }),
      input(items),
    );
    expect(result.outcome).toBe("nothing");
    expect(result.counts.extracted).toBe(2);
  });
});

describe("curatePool: dropping items stage by stage", () => {
  it("reports items the judge could not answer", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const skipped = items[4]?.id as string;
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table, new Set([skipped])) }),
      input(items),
    );
    expect(result.counts.unjudged).toBe(1);
    expect(result.written.dropped).toContainEqual({
      id: skipped,
      stage: "judge",
      reason: "no judgment",
    });
    expect(result.selection.items).toHaveLength(4);
  });

  it("drops a finalist with no readable source text", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const lost = items[0]?.id as string;
    const result = await curatePool(
      makeDeps({
        judge: new TableJudge(table),
        extract: async (item) =>
          item.id === lost
            ? null
            : { text: "Source text. ".repeat(100), method: "readability", truncated: false },
      }),
      input(items),
    );
    expect(result.selection.items.map((i) => i.id)).not.toContain(lost);
    expect(result.written.dropped).toContainEqual({
      id: lost,
      stage: "extract",
      reason: "no readable source text",
    });
  });

  it("drops an item the writer could not write", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const bad = items[1] as (typeof items)[number];
    const result = await curatePool(
      makeDeps({
        judge: new TableJudge(table),
        writer: fakeWriter({
          write: (m) =>
            m.id === bad.id
              ? null
              : {
                  id: m.id,
                  headline: `${m.title} retargets springs`,
                  summary: "A fact. Another fact.",
                  why: "Copy the pattern for toasts",
                },
        }),
      }),
      input(items),
    );
    expect(result.written.dropped.some((d) => d.id === bad.id && d.stage === "write")).toBe(true);
    expect(result.selection.items).toHaveLength(4);
  });

  it("rewrites a voice failure once, and drops the item if it still fails", async () => {
    const { items, table } = makePool(goodSpecs(6));
    const [fixable, hopeless] = [items[0], items[1]] as [
      (typeof items)[number],
      (typeof items)[number],
    ];
    const writer = fakeWriter({
      write: (m) =>
        m.id === fixable.id || m.id === hopeless.id
          ? {
              id: m.id,
              headline: "An incredible release!",
              summary: "A fact. Another fact.",
              why: "Copy the pattern for toasts",
            }
          : {
              id: m.id,
              headline: `${m.title} retargets springs`,
              summary: "A fact. Another fact.",
              why: "Copy the pattern for toasts",
            },
      rewrite: (r) =>
        r.material.id === fixable.id ? "Springs retarget mid-flight" : "Still incredible",
    });
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items),
    );
    const ids = result.selection.items.map((i) => i.id);
    expect(ids).toContain(fixable.id);
    expect(ids).not.toContain(hopeless.id);
    expect(result.written.items.find((i) => i.id === fixable.id)?.rewritten_fields).toEqual([
      "headline",
    ]);
    expect(result.written.dropped.find((d) => d.id === hopeless.id)).toMatchObject({
      stage: "voice",
    });
    expect(result.counts.voiceDropped).toBe(1);
  });

  it("rewrites an unsupported sentence once, then drops it if grounding still fails", async () => {
    const { items, table } = makePool(goodSpecs(6));
    const [fixable, hopeless] = [items[0], items[1]] as [
      (typeof items)[number],
      (typeof items)[number],
    ];
    const writer = fakeWriter({
      write: (m) => ({
        id: m.id,
        headline: `${m.title} retargets springs`,
        summary:
          m.id === fixable.id || m.id === hopeless.id
            ? "UNSUPPORTED claim. Another fact."
            : "A fact. Another fact.",
        why: "Copy the pattern for toasts",
      }),
      rewrite: (r) =>
        r.material.id === fixable.id
          ? "A supported fact. Another fact."
          : "Still UNSUPPORTED. Another fact.",
    });
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items),
    );
    const ids = result.selection.items.map((i) => i.id);
    expect(ids).toContain(fixable.id);
    expect(ids).not.toContain(hopeless.id);
    expect(result.written.dropped.find((d) => d.id === hopeless.id)).toMatchObject({
      stage: "grounding",
    });
    expect(result.counts.groundingDropped).toBe(1);
  });

  it("marks the selection unverified when no grounder is configured", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), grounder: null }),
      input(items),
    );
    expect(result.outcome).toBe("selected");
    expect(result.selection.verified).toBe(false);
    expect(result.written.items.every((i) => !i.verified)).toBe(true);
  });

  it("keeps the grounder reference stable for the helper", () => {
    expect(keywordGrounder.threshold).toBe(0.5);
  });
});

describe("curatePool: guards", () => {
  it("lets the spend guard abort the run", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const writer = fakeWriter();
    writer.write = async () => {
      throw new BudgetExceededError(100, 90, 50);
    };
    await expect(
      curatePool(makeDeps({ judge: new TableJudge(table), writer }), input(items)),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("passes the display name and author of each source to the writer", async () => {
    const { items, table } = makePool([
      { ...goodSpecs(1)[0], overrides: { source_id: "emil", author: "Emil Kowalski" } },
      ...goodSpecs(3),
    ]);
    const writer = fakeWriter();
    await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items, { sourceNames: { emil: "Emil Kowalski's blog" } }),
    );
    const first = writer.materials.find((m) => m.id === items[0]?.id);
    expect(first).toMatchObject({ source: "Emil Kowalski's blog", author: "Emil Kowalski" });
  });

  it("stamps nothing with the clock it was given", () => {
    expect(FIXED_NOW.toISOString()).toBe("2026-10-07T05:13:00.000Z");
  });
});
