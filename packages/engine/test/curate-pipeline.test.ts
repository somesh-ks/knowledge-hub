import { EMPTY_JUDGMENTS } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { type CurateInput, curatePool } from "../src/curate/pipeline.js";
import { Selection, WrittenFile } from "../src/curate/selectionFile.js";
import { BudgetExceededError } from "../src/llm/errors.js";
import {
  FIXED_NOW,
  fakeWriter,
  goodSpecs,
  keywordGrounder,
  longText,
  makeDeps,
  makePool,
  TableJudge,
} from "./curate-helpers.js";
import { realPreferences } from "./score-factories.js";

const WINDOW = { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" };

/** A summary inside the voice limits: three sentences, 31 words. The writer adds no why line. */
const SUMMARY =
  "A fact sits here with a number, 120 lines. Another fact explains what the change means for drawers on slow phones. The catch is that older browsers still need a fallback.";

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
    expect(result.selection?.items).toHaveLength(8);
    expect(result.selection?.verified).toBe(true);
    expect(result.selection?.mode).toBe("api");
    expect(result.selection?.window).toEqual(WINDOW);
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
    const first = result.selection?.items[0];
    expect(first?.headline).toContain("retargets springs mid-flight");
  });

  it("orders selection items best first, so Top picks come first", async () => {
    const { items, table } = makePool(goodSpecs(8));
    const result = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    const scores = result.selection?.items.map((i) => i.score) ?? [];
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

  it("carries no why line anywhere: the writer produces none and only the summary is grounded", async () => {
    const { items, table } = makePool(goodSpecs(4));
    const result = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    for (const item of result.selection?.items ?? []) expect(item).not.toHaveProperty("why");
    for (const entry of result.written.items) {
      expect(entry).not.toHaveProperty("why");
      expect(entry.grounding.map((g) => g.field)).toEqual(["summary", "summary", "summary"]);
    }
    expect(result.selection?.verified).toBe(true);
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
    expect(regular.selection?.items).toHaveLength(12);
    const weekly = await curatePool(
      makeDeps({ judge: new TableJudge(table) }),
      input(items, { kind: "weekly" }),
    );
    expect(weekly.selection?.items).toHaveLength(18);
    expect(weekly.selection?.kind).toBe("weekly");
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
      // Gossip is switched off in topics.json (never_publish), the way the owner mutes a category.
      input(items, { offCategories: ["venture_capital_and_gossip"] }),
    );
    expect(result.outcome).toBe("nothing");
    expect(result.selection).toMatchObject({ outcome: "nothing", items: [], verified: false });
    expect(writer.materials).toEqual([]);
    expect(result.written.dropped.some((d) => d.stage === "select")).toBe(true);
  });

  it("falls to nothing when editorial drops leave fewer than three, even with one isolated extraction failure", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const unreadable = items[0]?.id;
    const hopeless = new Set([items[1]?.id, items[2]?.id]);
    const writer = fakeWriter({
      write: (m) =>
        hopeless.has(m.id)
          ? {
              id: m.id,
              headline: "An incredible release!",
              summary: SUMMARY,
            }
          : {
              id: m.id,
              headline: `${m.title} retargets springs`,
              summary: SUMMARY,
            },
      rewrite: () => "Still incredible",
    });
    const result = await curatePool(
      makeDeps({
        judge: new TableJudge(table),
        writer,
        extract: async (item) => (item.id === unreadable ? null : longText(item)),
      }),
      input(items),
    );
    // One of five finalists (20 percent) could not be read: isolated, so not an outage.
    expect(result.outcome).toBe("nothing");
    expect(result.counts.extracted).toBe(4);
    expect(result.counts.voiceDropped).toBe(2);
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
    expect(result.selection?.items).toHaveLength(4);
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
    expect(result.selection?.items.map((i) => i.id)).not.toContain(lost);
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
                  summary: SUMMARY,
                },
        }),
      }),
      input(items),
    );
    expect(result.written.dropped.some((d) => d.id === bad.id && d.stage === "write")).toBe(true);
    expect(result.selection?.items).toHaveLength(4);
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
              summary: SUMMARY,
            }
          : {
              id: m.id,
              headline: `${m.title} retargets springs`,
              summary: SUMMARY,
            },
      rewrite: (r) =>
        r.material.id === fixable.id ? "Springs retarget mid-flight" : "Still incredible",
    });
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items),
    );
    const ids = result.selection?.items.map((i) => i.id) ?? [];
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
        summary: m.id === fixable.id || m.id === hopeless.id ? `UNSUPPORTED ${SUMMARY}` : SUMMARY,
      }),
      rewrite: (r) => (r.material.id === fixable.id ? SUMMARY : `Still UNSUPPORTED ${SUMMARY}`),
    });
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items),
    );
    const ids = result.selection?.items.map((i) => i.id) ?? [];
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
    expect(result.selection?.verified).toBe(false);
    expect(result.written.items.every((i) => !i.verified)).toBe(true);
  });

  it("keeps the grounder reference stable for the helper", () => {
    expect(keywordGrounder.threshold).toBe(0.5);
  });
});

describe("curatePool: an outage is a failure, not a quiet day", () => {
  it("fails when the judge answers none of the pool", async () => {
    const { items, table } = makePool(goodSpecs(6));
    const judge = new TableJudge(table, new Set(items.map((i) => i.id)));
    const writer = fakeWriter();
    const result = await curatePool(makeDeps({ judge, writer }), input(items));
    expect(result.outcome).toBe("failed");
    expect(result.selection).toBeNull();
    expect(result.failure).toContain("outage, not a quiet day");
    expect(result.failure).toContain("0 of 6");
    expect(writer.materials).toEqual([]);
  });

  it("fails when half or more of the pool goes unjudged and nothing clears the bar", async () => {
    const { items, table } = makePool(goodSpecs(6));
    const skipped = new Set(items.slice(2).map((i) => i.id));
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table, skipped) }),
      input(items),
    );
    expect(result.outcome).toBe("failed");
    expect(result.counts.unjudged).toBe(4);
  });

  it("still publishes when some of the pool goes unjudged but enough clears the bar", async () => {
    const { items, table } = makePool(goodSpecs(8));
    const skipped = new Set(items.slice(0, 4).map((i) => i.id));
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table, skipped) }),
      input(items),
    );
    expect(result.outcome).toBe("selected");
    expect(result.selection?.items).toHaveLength(4);
  });

  it("calls a quiet day nothing when the judge answered everything", async () => {
    const { items, table } = makePool([
      ...goodSpecs(2),
      { category: "none" },
      { category: "none" },
    ]);
    const result = await curatePool(makeDeps({ judge: new TableJudge(table) }), input(items));
    expect(result.outcome).toBe("nothing");
    expect(result.failure).toBeUndefined();
  });

  it("fails when extraction fails for every finalist", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), extract: async () => null }),
      input(items),
    );
    expect(result.outcome).toBe("failed");
    expect(result.failure).toContain("5 of 5 finalists could not be extracted or written");
  });

  it("fails when the writer fails for every finalist", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer: fakeWriter({ write: () => null }) }),
      input(items),
    );
    expect(result.outcome).toBe("failed");
  });

  it("treats voice and grounding drops as editorial, so a run that loses every item to them is nothing", async () => {
    const { items, table } = makePool(goodSpecs(5));
    const writer = fakeWriter({
      write: (m) => ({
        id: m.id,
        headline: "An incredible release!",
        summary: SUMMARY,
      }),
      rewrite: () => "Still incredible",
    });
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table), writer }),
      input(items),
    );
    expect(result.outcome).toBe("nothing");
    expect(result.counts.voiceDropped).toBe(5);
  });

  it("keeps the judgments of a failed run so a retry does not judge again", async () => {
    const { items, table } = makePool(goodSpecs(6));
    const skipped = new Set(items.slice(2).map((i) => i.id));
    const result = await curatePool(
      makeDeps({ judge: new TableJudge(table, skipped) }),
      input(items),
    );
    expect(Object.keys(result.judgments.entries)).toHaveLength(2);
  });

  it("treats an empty pool as nothing without calling any model", async () => {
    const judge = new TableJudge(new Map());
    const writer = fakeWriter();
    const result = await curatePool(makeDeps({ judge, writer }), input([]));
    expect(result.outcome).toBe("nothing");
    expect(result.selection).toMatchObject({ outcome: "nothing", items: [] });
    expect(judge.asked).toEqual([]);
    expect(writer.materials).toEqual([]);
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
