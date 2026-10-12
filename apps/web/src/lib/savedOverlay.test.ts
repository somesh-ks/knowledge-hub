import { describe, expect, it } from "vitest";
import type { ConfigOp } from "../types/contracts";
import {
  addSaved,
  parseSaved,
  SAVED_TTL_MS,
  savedControl,
  savedFields,
  savedOps,
  savedScope,
  savedTopics,
} from "./savedOverlay";

const T0 = 1_760_000_000_000;

describe("keeping what was saved", () => {
  it("adds each request that went through, oldest first, and reads it back", () => {
    const first = addSaved([], [{ op: "schedule.set", hour: 7 }], T0);
    const both = addSaved(first, [{ op: "source.set", id: "a", enabled: false }], T0 + 1000);
    const read = parseSaved(JSON.stringify(both), T0 + 2000);
    expect(savedOps(read, T0 + 2000)).toEqual([
      { op: "schedule.set", hour: 7 },
      { op: "source.set", id: "a", enabled: false },
    ]);
  });

  it("forgets an edit once the build has had time to land, and one dated in the future", () => {
    const entries = addSaved([], [{ op: "schedule.set", hour: 7 }], T0);
    expect(savedOps(entries, T0 + SAVED_TTL_MS - 1)).toHaveLength(1);
    expect(savedOps(entries, T0 + SAVED_TTL_MS)).toEqual([]);
    expect(parseSaved(JSON.stringify(entries), T0 + SAVED_TTL_MS)).toEqual([]);
    expect(parseSaved(JSON.stringify(entries), T0 - 1)).toEqual([]);
    // Adding drops what is too old to show, so storage does not grow.
    const later = addSaved(entries, [{ op: "schedule.set", hour: 8 }], T0 + SAVED_TTL_MS + 1);
    expect(later).toHaveLength(1);
  });

  it("leaves the writer to its own note", () => {
    expect(addSaved([], [{ op: "writer.set", provider: "nebius", model: null }], T0)).toEqual([]);
  });

  it("reads nothing from storage it does not understand", () => {
    for (const raw of [null, "", "{", "{}", "[1]", '[{"at":"x","ops":[]}]']) {
      expect(parseSaved(raw, T0)).toEqual([]);
    }
    expect(parseSaved(JSON.stringify([{ at: T0, ops: [{ op: "x" }, 3, null] }]), T0)).toEqual([
      { at: T0, ops: [{ op: "x" }] },
    ]);
  });
});

describe("savedFields", () => {
  const baked = {
    "daily.hour": "6",
    "daily.cadence": "2",
    "daily.length": "5",
    "daily.voice": "",
    "daily.voice_b": "",
    "daily.format": "readout",
  };

  it("lays each schedule edit over what the page was built with", () => {
    const ops: ConfigOp[] = [
      { op: "schedule.set", hour: 7, cadence_days: 3, voice_id: "ava", format: "discussion" },
    ];
    expect(savedFields(baked, ops)).toEqual({
      "daily.hour": "7",
      "daily.cadence": "3",
      "daily.voice": "ava",
      "daily.format": "discussion",
    });
  });

  it("files the weekly and custom fields under their own profile, and Default as empty", () => {
    const weekly = { "weekly.enabled": "true", "weekly.day": "0", "weekly.voice": "ava" };
    const ops: ConfigOp[] = [
      { op: "schedule.set", hour: 9, weekly: { enabled: false, day: 5, voice_id: null } },
    ];
    expect(savedFields(weekly, ops)).toEqual({
      "weekly.enabled": "false",
      "weekly.day": "5",
      "weekly.voice": "",
    });
  });

  it("takes a later save of the same control over an earlier one", () => {
    const ops: ConfigOp[] = [
      { op: "schedule.set", hour: 7 },
      { op: "schedule.set", hour: 8 },
    ];
    expect(savedFields(baked, ops)).toEqual({ "daily.hour": "8" });
    // Put back to what the page was built with: nothing to show.
    expect(savedFields(baked, [...ops, { op: "schedule.set", hour: 6 }])).toEqual({});
  });

  it("is empty once the page is built with the saved value: the build has landed", () => {
    const ops: ConfigOp[] = [{ op: "schedule.set", hour: 7, length_minutes: 10 }];
    expect(savedFields({ ...baked, "daily.hour": "7", "daily.length": "10" }, ops)).toEqual({});
    expect(savedFields({ ...baked, "daily.hour": "7" }, ops)).toEqual({ "daily.length": "10" });
  });
});

describe("savedScope", () => {
  it("says the last saved scope of a set of topics, when an edit covers all of them", () => {
    const ops: ConfigOp[] = [
      { op: "topic.scope", ids: ["ui", "motion"], daily: false },
      { op: "topic.scope", ids: ["ui"], weekly: true },
      { op: "topic.scope", ids: ["ui", "motion"], daily: true },
    ];
    expect(savedScope(ops, "daily", ["ui", "motion"])).toBe(true);
    expect(savedScope(ops.slice(0, 1), "daily", ["motion"])).toBe(false);
    expect(savedScope(ops, "weekly", ["ui", "motion"])).toBeUndefined();
    expect(savedScope(ops, "weekly", ["ui"])).toBe(true);
    expect(savedScope(ops, "custom", ["ui"])).toBeUndefined();
  });
});

describe("savedControl", () => {
  const ops: ConfigOp[] = [
    { op: "source.set", id: "a", enabled: false },
    { op: "weights.set", weights: { ui: 0.75, ai: 0.25 } },
    { op: "source.set", id: "a", pinned: true },
    {
      op: "topic.upsert",
      topic: {
        id: "mine",
        name: "Mine",
        description: "d",
        weight: 0.5,
        enabled: false,
        keywords: [],
        section_id: "mine",
      },
    },
    { op: "topic.scope", ids: ["ui"], weekly: false },
  ];

  it("finds the saved value of each kind of control", () => {
    expect(savedControl(ops, { op: "source.set", id: "a", enabled: true }, "enabled")).toBe(
      "false",
    );
    expect(savedControl(ops, { op: "source.set", id: "b", enabled: true }, "enabled")).toBe(
      undefined,
    );
    expect(savedControl(ops, { op: "weights.set", weights: {} }, "weights.ui")).toBe("0.75");
    expect(savedControl(ops, { op: "weights.set", weights: {} }, "weights.motion")).toBe(undefined);
    const upsert = ops[3] as Extract<ConfigOp, { op: "topic.upsert" }>;
    expect(savedControl(ops, upsert, "topic.enabled")).toBe("false");
    expect(savedControl(ops, { op: "topic.scope", ids: ["ui"] }, "weekly")).toBe("false");
    expect(savedControl(ops, { op: "topic.scope", ids: ["ui"] }, "daily")).toBe(undefined);
  });

  it("takes the later of two saves of one control", () => {
    const twice: ConfigOp[] = [...ops, { op: "weights.set", weights: { ui: 0.5 } }];
    expect(savedControl(twice, { op: "weights.set", weights: {} }, "weights.ui")).toBe("0.5");
  });
});

describe("savedTopics", () => {
  const topic = (id: string, name: string) => ({
    op: "topic.upsert" as const,
    topic: { id, name, description: "", weight: 0.5, enabled: true, keywords: [], section_id: id },
  });

  it("collects added and renamed topics, removals, source edits and added feeds", () => {
    const saved = savedTopics([
      topic("knit", "Knitting"),
      topic("knit", "Knitting news"),
      { op: "topic.remove", id: "old" },
      { op: "source.update", id: "s1", name: "One" },
      { op: "source.update", id: "s1", topic_ids: ["knit"] },
      { op: "source.remove", id: "s2" },
      { op: "source.add", url: "https://knit.example/feed", topic_ids: ["knit"] },
    ]);
    expect(saved.topics.get("knit")?.name).toBe("Knitting news");
    expect([...saved.removedTopics]).toEqual(["old"]);
    expect(saved.sources.get("s1")).toEqual({ name: "One", topic_ids: ["knit"] });
    expect([...saved.removedSources]).toEqual(["s2"]);
    expect([...saved.feeds]).toEqual(["https://knit.example/feed"]);
  });

  it("lets a later edit undo an earlier one", () => {
    const saved = savedTopics([
      topic("knit", "Knitting"),
      { op: "topic.remove", id: "knit" },
      { op: "topic.remove", id: "old" },
      topic("old", "Old"),
    ]);
    expect(saved.topics.has("knit")).toBe(false);
    expect([...saved.removedTopics]).toEqual(["knit"]);
    expect(saved.topics.get("old")?.name).toBe("Old");
  });
});
