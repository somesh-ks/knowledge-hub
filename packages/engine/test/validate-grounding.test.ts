import { describe, expect, it } from "vitest";
import type { JevClientLike } from "../src/judge/jev.js";
import { BudgetExceededError } from "../src/llm/errors.js";
import { bestExcerpt, contentTokens } from "../src/validate/excerpt.js";
import {
  DEFAULT_GROUNDING_THRESHOLD,
  GROUNDING_QUESTION,
  type Grounder,
  type GroundingTarget,
  type GroundingVerdict,
  groundedSentences,
  JevGrounder,
} from "../src/validate/grounding.js";
import { groundAndRepair } from "../src/validate/groundingRepair.js";
import type { RewriteRequest, SourceMaterial, Writer, WrittenItem } from "../src/write/types.js";
import { captureLog, httpError, NO_WAIT, testLinter } from "./write-fakes.js";

const linter = testLinter();

describe("contentTokens", () => {
  it("drops stopwords, stems plurals and keeps version numbers", () => {
    expect(contentTokens("The springs retarget in version 2.0 for the drawers")).toEqual([
      "spring",
      "retarget",
      "version",
      "2.0",
      "drawer",
    ]);
  });
});

describe("bestExcerpt", () => {
  const filler = (words: number, tag: string): string =>
    Array.from({ length: words }, (_, i) => `${tag}${i % 7}`).join(" ");

  it("returns a short source whole", () => {
    const source = "Springlet 2.0 retargets springs mid-flight.";
    expect(bestExcerpt(source, "Springlet retargets springs")).toEqual({
      text: source,
      overlap: 1,
    });
  });

  it("returns nothing for an empty source", () => {
    expect(bestExcerpt("", "anything")).toEqual({ text: "", overlap: 0 });
  });

  it("finds the window holding the sentence's facts in a long source", () => {
    const fact = "The team measured a 62 percent velocity loss on a mid-range Android phone.";
    const source = `${filler(400, "alpha")} ${fact} ${filler(400, "omega")}`;
    const excerpt = bestExcerpt(
      source,
      "Interrupted drawers lost 62 percent of velocity on an Android phone.",
    );
    expect(excerpt.text).toContain("62 percent velocity loss");
    expect(excerpt.text.split(/\s+/).length).toBeLessThanOrEqual(160);
    expect(excerpt.overlap).toBeGreaterThan(0.6);
  });

  it("weights numbers double, so the window with the number wins a close call", () => {
    const wordsHere = "springs drawers velocity";
    const source = `${filler(150, "pad")} ${wordsHere} ${filler(200, "pad")} springs drawers 62 ${filler(150, "pad")}`;
    const excerpt = bestExcerpt(source, "Springs drawers 62", { windowWords: 60, step: 20 });
    expect(excerpt.text).toContain("62");
  });

  it("prefers the earliest window on a tie and covers the end of the source", () => {
    const source = `${filler(100, "a")} needle ${filler(100, "b")} needle ${filler(100, "c")}`;
    const first = bestExcerpt(source, "needle", { windowWords: 50, step: 25 });
    expect(source.indexOf(first.text)).toBeLessThan(source.lastIndexOf("needle") - 100);
    const tail = bestExcerpt(`${filler(300, "x")} zebra`, "zebra", { windowWords: 50, step: 40 });
    expect(tail.text).toContain("zebra");
  });

  it("falls back to the opening window for a sentence with no content words", () => {
    const source = filler(300, "w");
    const excerpt = bestExcerpt(source, "It is what it is.");
    expect(excerpt.overlap).toBe(0);
    expect(source.startsWith(excerpt.text)).toBe(true);
  });
});

describe("groundedSentences", () => {
  it("lists each summary sentence then the why sentence", () => {
    expect(groundedSentences({ summary: "One fact. Two facts.", why: "Copy it" })).toEqual([
      { field: "summary", sentence: "One fact." },
      { field: "summary", sentence: "Two facts." },
      { field: "why", sentence: "Copy it" },
    ]);
  });

  it("lists only the summary sentences when the item has no why line", () => {
    expect(groundedSentences({ summary: "One fact. Two facts. A catch." })).toEqual([
      { field: "summary", sentence: "One fact." },
      { field: "summary", sentence: "Two facts." },
      { field: "summary", sentence: "A catch." },
    ]);
    expect(groundedSentences({ summary: "One fact.", why: undefined })).toEqual([
      { field: "summary", sentence: "One fact." },
    ]);
  });
});

interface FakeJev extends JevClientLike {
  calls: Array<{
    state: Record<string, string>;
    questions: Record<string, unknown>;
    model?: string;
  }>;
}

function fakeJev(score: (state: Record<string, string>, call: number) => number | Error): FakeJev {
  const fake: FakeJev = {
    calls: [],
    async systemOne(request) {
      const state = request.state as Record<string, string>;
      fake.calls.push({ state, questions: request.questions, model: request.model });
      const outcome = score(state, fake.calls.length - 1);
      if (outcome instanceof Error) throw outcome;
      return {
        model: "jev-1.13.0",
        answers: { supported: { type: "noul", noul: outcome } },
        usage: { input_tokens: 10, output_tokens: 1 },
      };
    },
  };
  return fake;
}

const target = (overrides: Partial<GroundingTarget> = {}): GroundingTarget => ({
  id: "aaaaaaaaaaaa",
  summary: "Springlet 2.0 keeps velocity on retarget. Drawers lose under 4 percent.",
  why: "Copy the pattern for toasts",
  sourceText:
    "Springlet 2.0 keeps velocity when the target changes. With a mutable target the loss was under 4 percent for drawers. Toasts follow the same pattern.",
  ...overrides,
});

describe("JevGrounder", () => {
  it("asks one Noul per sentence over the sentence and its source excerpt", async () => {
    const fake = fakeJev(() => 0.9);
    const verdict = await new JevGrounder({ client: fake, retry: NO_WAIT }).ground(target());
    expect(fake.calls).toHaveLength(3);
    expect(Object.keys(fake.calls[0]?.state ?? {})).toEqual(["sentence", "source_excerpt"]);
    expect(fake.calls[0]?.state.sentence).toBe("Springlet 2.0 keeps velocity on retarget.");
    expect(fake.calls[0]?.state.source_excerpt).toContain("keeps velocity when the target changes");
    expect(Object.keys(fake.calls[0]?.questions ?? {})).toEqual(["supported"]);
    expect(verdict.sentences.map((s) => s.status)).toEqual(["supported", "supported", "supported"]);
    expect(verdict.id).toBe("aaaaaaaaaaaa");
  });

  it("asks nothing about a why line the item does not have", async () => {
    const fake = fakeJev(() => 0.9);
    const { why: _why, ...withoutWhy } = target();
    const verdict = await new JevGrounder({ client: fake, retry: NO_WAIT }).ground(withoutWhy);
    expect(fake.calls).toHaveLength(2);
    expect(verdict.sentences.map((s) => s.field)).toEqual(["summary", "summary"]);
  });

  it("states the question literally, pointing at the state fields", () => {
    expect(GROUNDING_QUESTION.type).toBe("noul");
    expect(GROUNDING_QUESTION.instructions).toBe(
      "The `source_excerpt` directly supports the `sentence`.",
    );
  });

  it("applies the threshold: 0.5 by default, inclusive", async () => {
    expect(DEFAULT_GROUNDING_THRESHOLD).toBe(0.5);
    const scores = [0.5, 0.49, 0.9];
    const verdict = await new JevGrounder({
      client: fakeJev((_, i) => scores[i] as number),
      retry: NO_WAIT,
      concurrency: 1,
    }).ground(target());
    expect(verdict.sentences.map((s) => s.status)).toEqual([
      "supported",
      "unsupported",
      "supported",
    ]);
    expect(verdict.sentences.map((s) => s.score)).toEqual([0.5, 0.49, 0.9]);
  });

  it("accepts a custom threshold", async () => {
    const grounder = new JevGrounder({
      client: fakeJev(() => 0.7),
      threshold: 0.8,
      retry: NO_WAIT,
    });
    expect(grounder.threshold).toBe(0.8);
    const verdict = await grounder.ground(target());
    expect(verdict.sentences.every((s) => s.status === "unsupported")).toBe(true);
  });

  it("passes the pinned model through", async () => {
    const fake = fakeJev(() => 1);
    await new JevGrounder({ client: fake, model: "jev-1.13.0", retry: NO_WAIT }).ground(target());
    expect(fake.calls[0]?.model).toBe("jev-1.13.0");
  });

  it("retries a rate limit and then succeeds", async () => {
    const fake = fakeJev((_, call) => (call === 0 ? httpError(429, "slow") : 0.9));
    const verdict = await new JevGrounder({ client: fake, retry: NO_WAIT }).ground(
      target({ summary: "One fact.", why: "Copy it" }),
    );
    expect(verdict.sentences.every((s) => s.status === "supported")).toBe(true);
  });

  it("reports a failed check as an error status, never a pass, and keeps keys out of it", async () => {
    const { log, lines } = captureLog();
    const secret = "tsk_supersecret_12345";
    const fake = fakeJev(() => httpError(500, `down ${secret}`));
    const verdict = await new JevGrounder({
      client: fake,
      retry: { ...NO_WAIT, retries: 1 },
      secrets: [secret],
      log,
    }).ground(target({ summary: "One fact.", why: "Copy it" }));
    expect(verdict.sentences.map((s) => s.status)).toEqual(["error", "error"]);
    expect(verdict.sentences[0]?.score).toBeNull();
    expect(JSON.stringify([verdict, lines])).not.toContain(secret);
  });

  it("treats a malformed reply as an error status", async () => {
    const client: JevClientLike = { systemOne: async () => ({ nope: true }) };
    const verdict = await new JevGrounder({ client, retry: NO_WAIT }).ground(
      target({ summary: "One fact.", why: "Copy it" }),
    );
    expect(verdict.sentences[0]?.status).toBe("error");
  });
});

describe("groundAndRepair", () => {
  const material = (id: string): SourceMaterial => ({
    id,
    title: "Springlet",
    source: "Example",
    category: "css_canvas_motion_techniques",
    text: "Springlet 2.0 keeps velocity when the target changes.",
  });
  const item = (
    id: string,
    summary = "Springlet 2.0 keeps velocity. Drawers lose under 4 percent.",
  ): WrittenItem => ({
    id,
    headline: "Springlet 2.0 keeps velocity",
    summary,
  });
  /** A rewrite that passes the voice limits: three sentences, 34 words. */
  const REWRITE =
    "Springlet 2.0 keeps velocity when the target changes. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.";

  /** A grounder that flags any sentence containing the word UNSUPPORTED. */
  const grounder: Grounder = {
    threshold: 0.5,
    async ground(t): Promise<GroundingVerdict> {
      return {
        id: t.id,
        sentences: groundedSentences(t).map((s) => ({
          ...s,
          score: s.sentence.includes("UNSUPPORTED") ? 0.1 : 0.9,
          status: s.sentence.includes("UNSUPPORTED") ? "unsupported" : "supported",
        })),
      };
    },
  };

  const writerOf = (answers: Array<string | null>): Writer & { requests: RewriteRequest[] } => {
    const requests: RewriteRequest[] = [];
    return {
      requests,
      async write() {
        return { written: [], failed: [] };
      },
      async rewrite(request) {
        requests.push(request);
        return answers.shift() ?? null;
      },
    };
  };

  const run = (items: WrittenItem[], writer: Writer, g: Grounder | null = grounder) =>
    groundAndRepair({
      grounder: g,
      writer,
      linter,
      items,
      materials: new Map(items.map((i) => [i.id, material(i.id)])),
    });

  it("keeps every item unverified when no grounder is configured", async () => {
    const out = await run([item("aaaaaaaaaaaa")], writerOf([]), null);
    expect(out.verified).toBe(false);
    expect(out.kept[0]?.verified).toBe(false);
    expect(out.dropped).toEqual([]);
  });

  it("verifies items whose sentences are all supported, with no rewrite", async () => {
    const writer = writerOf([]);
    const out = await run([item("aaaaaaaaaaaa")], writer);
    expect(out.verified).toBe(true);
    expect(out.kept[0]).toMatchObject({ verified: true, rewrittenFields: [] });
    expect(writer.requests).toHaveLength(0);
  });

  it("checks only the summary of an item without a why line, and keeps it that way", async () => {
    const targets: GroundingTarget[] = [];
    const recording: Grounder = {
      threshold: 0.5,
      async ground(t) {
        targets.push(t);
        return grounder.ground(t);
      },
    };
    const out = await run([item("aaaaaaaaaaaa")], writerOf([]), recording);
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("why");
    expect(out.kept[0]?.checks.map((c) => c.field)).toEqual(["summary", "summary"]);
    expect(out.kept[0]?.item).not.toHaveProperty("why");
    expect(out.verified).toBe(true);
  });

  it("still checks a why line that an agent session supplied", async () => {
    const withWhy = { ...item("aaaaaaaaaaaa"), why: "Copy the pattern for toasts" };
    const out = await run([withWhy], writerOf([]));
    expect(out.kept[0]?.checks.map((c) => c.field)).toEqual(["summary", "summary", "why"]);
  });

  it("rewrites an unsupported sentence once, rechecks, and keeps the item", async () => {
    const writer = writerOf([REWRITE]);
    const bad = item("aaaaaaaaaaaa", "Springlet 2.0 keeps velocity. UNSUPPORTED drawers claim.");
    const out = await run([bad], writer);
    expect(out.kept[0]?.item.summary).toBe(REWRITE);
    expect(out.kept[0]?.rewrittenFields).toEqual(["summary"]);
    expect(out.kept[0]?.verified).toBe(true);
    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]?.field).toBe("summary");
    // The unsupported sentence is model text, so it travels as delimited focus data and never
    // inside the trusted problem statement.
    expect(writer.requests[0]?.focus).toEqual(["UNSUPPORTED drawers claim."]);
    expect(writer.requests[0]?.problems[0]).toContain("does not support");
    expect(writer.requests[0]?.problems[0]).not.toContain("UNSUPPORTED");
  });

  it("keeps the spoken telling when the summary stands, and drops it when the summary is rewritten", async () => {
    const telling = "Springlet 2.0 keeps velocity, and drawers lose under 4 percent.";
    const fine = { ...item("aaaaaaaaaaaa"), spoken: telling };
    const kept = await run([fine], writerOf([]));
    expect(kept.kept[0]?.item.spoken).toBe(telling);

    const bad = {
      ...item("bbbbbbbbbbbb", "Springlet 2.0 keeps velocity. UNSUPPORTED drawers claim."),
      spoken: telling,
    };
    const fixed = await run([bad], writerOf([REWRITE]));
    expect(fixed.kept[0]?.item.summary).toBe(REWRITE);
    // The telling was written from the old summary, so narration falls back to the new one.
    expect(fixed.kept[0]?.item).not.toHaveProperty("spoken");
  });

  it("drops an item still unsupported after its one rewrite and reports the sentences", async () => {
    const writer = writerOf([
      "Another UNSUPPORTED claim about drawers that the source never makes at any point. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript.",
    ]);
    const bad = item("aaaaaaaaaaaa", "Springlet 2.0 keeps velocity. UNSUPPORTED drawers claim.");
    const out = await run([bad], writer);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]).toMatchObject({ id: "aaaaaaaaaaaa", reason: "unsupported" });
    expect(out.dropped[0]?.unsupported[0]?.sentence).toContain("UNSUPPORTED");
    expect(writer.requests).toHaveLength(1);
    expect(out.verified).toBe(false);
  });

  it("drops an item when the writer cannot rewrite it", async () => {
    const bad = item("aaaaaaaaaaaa", "UNSUPPORTED claim.");
    const out = await run([bad], writerOf([null]));
    expect(out.dropped[0]?.reason).toBe("unsupported");
  });

  it("drops an item whose rewrite breaks the voice rules", async () => {
    const bad = item("aaaaaaaaaaaa", "UNSUPPORTED claim.");
    const out = await run([bad], writerOf(["An incredible, game-changing release."]));
    expect(out.dropped[0]?.reason).toBe("voice");
    expect(out.dropped[0]?.violations.length).toBeGreaterThan(0);
  });

  it("drops an item whose rewrite falls under the summary minimum", async () => {
    const bad = item("aaaaaaaaaaaa", "Springlet 2.0 keeps velocity. UNSUPPORTED drawers claim.");
    const out = await run(
      [bad],
      writerOf(["Springlet 2.0 keeps velocity when the target changes."]),
    );
    expect(out.dropped[0]?.reason).toBe("voice");
    expect(out.dropped[0]?.violations.map((v) => v.rule)).toEqual([
      "too_few_words",
      "too_few_sentences",
    ]);
  });

  it("rewrites only the field that holds the unsupported sentence", async () => {
    const writer = writerOf(["Copy the pattern for drawers"]);
    const bad = { ...item("aaaaaaaaaaaa"), why: "UNSUPPORTED advice" };
    const out = await run([bad], writer);
    expect(writer.requests.map((r) => r.field)).toEqual(["why"]);
    expect(out.kept[0]?.rewrittenFields).toEqual(["why"]);
  });

  it("keeps an item unverified when its checks error out, and marks the run unverified", async () => {
    const flaky: Grounder = {
      threshold: 0.5,
      async ground(t) {
        return {
          id: t.id,
          sentences: [
            { field: "summary", sentence: "x", score: null, status: "error", error: "down" },
          ],
        };
      },
    };
    const out = await run([item("aaaaaaaaaaaa")], writerOf([]), flaky);
    expect(out.kept[0]?.verified).toBe(false);
    expect(out.verified).toBe(false);
    expect(out.dropped).toEqual([]);
  });

  it("handles several items and preserves order", async () => {
    const items = [
      item("aaaaaaaaaaaa"),
      item("bbbbbbbbbbbb", "UNSUPPORTED claim."),
      item("cccccccccccc"),
    ];
    const out = await run(items, writerOf([null]));
    expect(out.kept.map((k) => k.item.id)).toEqual(["aaaaaaaaaaaa", "cccccccccccc"]);
    expect(out.dropped.map((d) => d.id)).toEqual(["bbbbbbbbbbbb"]);
  });

  it("lets a budget error abort the stage", async () => {
    const writer: Writer = {
      async write() {
        return { written: [], failed: [] };
      },
      async rewrite() {
        throw new BudgetExceededError(10, 10, 5);
      },
    };
    await expect(run([item("aaaaaaaaaaaa", "UNSUPPORTED claim.")], writer)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });
});
