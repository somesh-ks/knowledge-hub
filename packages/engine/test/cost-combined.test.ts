import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY_TOPIC_JUDGMENTS, type Topic } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { lookupJudgments, mergeJudgments } from "../src/judge/cache.js";
import { CombinedJudge } from "../src/judge/combinedJudge.js";
import { DEFAULT_JEV_MODEL, type JevClientLike, JevJudge } from "../src/judge/jev.js";
import { JEV_QUESTIONS, QUESTIONS_HASH } from "../src/judge/questions.js";
import { planTopicJudging, TopicJudge } from "../src/judge/topicJudge.js";
import { neutralEntry, topicOnlyTopics } from "../src/judge/topicOnly.js";
import type { JudgeFailure } from "../src/judge/types.js";
import { meterJev, RequestMeter } from "../src/llm/requestMeter.js";
import { makeItem } from "./score-factories.js";
import { httpError, NO_WAIT } from "./write-fakes.js";

const here = dirname(fileURLToPath(import.meta.url));
const recorded = JSON.parse(
  readFileSync(join(here, "fixtures", "judge-jev-response.json"), "utf8"),
) as { model: string; answers: Record<string, unknown>; usage?: unknown };
const NOW = new Date("2026-10-08T08:00:00Z");

function topic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    name: `Topic ${id}`,
    description: `Everything about ${id}.`,
    enabled: true,
    keywords: [id],
    section_id: id,
    never_publish: false,
    origin: "custom",
    depth: "fit_only",
    ...overrides,
  };
}

type Call = { state: unknown; questions: Record<string, unknown>; model?: string };

/** Answers every question: the recorded main answers plus a fit score for each `fit_n` asked. */
function fakeJev(
  handler: (call: number, request: Call) => unknown = (_n, request) => reply(request),
): JevClientLike & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async systemOne(request) {
      const n = calls.length;
      calls.push(request as unknown as Call);
      return handler(n, request as unknown as Call);
    },
  };
}

function reply(request: Call, fit: unknown = { type: "score", score: 4 }): unknown {
  const answers: Record<string, unknown> = { ...recorded.answers };
  for (const key of Object.keys(request.questions)) {
    if (key.startsWith("fit_")) answers[key] = fit;
  }
  return { ...recorded, answers, usage: { input_tokens: 10, output_tokens: 2 } };
}

const options = (client: JevClientLike, extra: Record<string, unknown> = {}) => ({
  client,
  now: () => NOW,
  retry: NO_WAIT,
  ...extra,
});

describe("CombinedJudge", () => {
  const quantum = topic("quantum");
  const item = makeItem({ title: "A quantum thing" });

  it("sends one request whose questions are the main set plus the fit questions", async () => {
    const jev = fakeJev();
    await new CombinedJudge(options(jev)).judge([{ item, topics: [quantum, topic("other")] }]);
    expect(jev.calls).toHaveLength(1);
    expect(Object.keys(jev.calls[0]?.questions ?? {}).sort()).toEqual(
      [...Object.keys(JEV_QUESTIONS), "fit_0", "fit_1"].sort(),
    );
  });

  it("splits one reply into entries identical to what the two separate judges produce", async () => {
    const combinedJev = fakeJev();
    const combined = await new CombinedJudge(options(combinedJev)).judge([
      { item, topics: [quantum] },
    ]);
    const mainJev = fakeJev();
    const main = await new JevJudge(options(mainJev)).judge([item]);
    const topicJev = fakeJev();
    const fits = await new TopicJudge(options(topicJev)).judge([{ item, topics: [quantum] }]);
    expect(combined.entries).toEqual(main);
    expect(combined.topicEntries).toEqual(fits);
    expect(combined.entries[0]?.questions_hash).toBe(QUESTIONS_HASH);
    // Two judges would have made two requests for this item.
    expect(mainJev.calls.length + topicJev.calls.length).toBe(2);
    expect(combinedJev.calls).toHaveLength(1);
  });

  it("drops only the malformed topic answer when two topics are asked", async () => {
    const jev = fakeJev((_n, request) => {
      const r = reply(request) as { answers: Record<string, unknown> };
      r.answers.fit_1 = { type: "nope" };
      return r;
    });
    const out = await new CombinedJudge(options(jev)).judge([
      { item, topics: [quantum, topic("other")] },
    ]);
    expect(out.entries).toHaveLength(1);
    expect(out.topicEntries.map((e) => e.topic_id)).toEqual(["quantum"]);
  });

  it("drops the main entry, keeps valid topic entries, and reports the failure when the main answer is malformed", async () => {
    const failures: JudgeFailure[] = [];
    const jev = fakeJev((_n, request) => {
      const r = reply(request) as { answers: Record<string, unknown> };
      r.answers.category = { type: "choice" };
      return r;
    });
    const out = await new CombinedJudge(
      options(jev, { onFailure: (f: JudgeFailure) => failures.push(f) }),
    ).judge([{ item, topics: [quantum] }]);
    expect(out.entries).toEqual([]);
    expect(out.topicEntries).toHaveLength(1);
    expect(failures.map((f) => f.itemId)).toEqual([item.id]);
  });

  it("hands an item Jev could not answer to the fallback judge", async () => {
    const jev = fakeJev(() => {
      throw httpError(400, "bad request");
    });
    const fallback = {
      name: "nebius",
      model: "nebius-x",
      questionsHash: "h",
      judge: async (items: { id: string }[]) =>
        items.map((i) => ({ item_id: i.id, model: "nebius-x" }) as never),
    };
    const out = await new CombinedJudge(options(jev, { fallback })).judge([
      { item, topics: [quantum] },
    ]);
    expect(out.entries.map((e) => e.model)).toEqual(["nebius-x"]);
  });

  it("counts one request for one item when metered", async () => {
    const meter = new RequestMeter();
    const jev = fakeJev();
    await new CombinedJudge(options(meterJev(jev, meter))).judge([{ item, topics: [quantum] }]);
    expect(meter.get("jev")).toBe(1);
  });

  it("retries a transient error once, then succeeds with two client calls", async () => {
    const jev = fakeJev((n, request) => {
      if (n === 0) throw httpError(529, "overloaded");
      return reply(request);
    });
    const out = await new CombinedJudge(options(jev)).judge([{ item, topics: [quantum] }]);
    expect(jev.calls).toHaveLength(2);
    expect(out.entries).toHaveLength(1);
  });

  it("reports a failure for the item on a permanent error and yields nothing", async () => {
    const failures: JudgeFailure[] = [];
    const jev = fakeJev(() => {
      throw httpError(401, "unauthorized");
    });
    const out = await new CombinedJudge(
      options(jev, { onFailure: (f: JudgeFailure) => failures.push(f) }),
    ).judge([{ item, topics: [quantum] }]);
    expect(jev.calls).toHaveLength(1);
    expect(out).toEqual({ entries: [], topicEntries: [] });
    expect(failures).toHaveLength(1);
  });
});

describe("topic-only items and cached items", () => {
  const trending = topic("trending", { depth: "coverage", origin: "app" });

  it("recognizes a coverage-topic item without a category hint, and no other", () => {
    const tagged = makeItem({ topic_ids: ["trending"] });
    expect(topicOnlyTopics(tagged, [trending])).toEqual([trending]);
    expect(
      topicOnlyTopics(
        makeItem({ topic_ids: ["trending"], category_hint: "frontier_model_releases" }),
        [trending],
      ),
    ).toEqual([]);
    expect(topicOnlyTopics(tagged, [topic("trending")])).toEqual([]);
    expect(topicOnlyTopics(makeItem(), [trending])).toEqual([]);
  });

  it("asks a topic-only item only the fit question and gives it a neutral judgment that stays out of the cache", async () => {
    const item = makeItem({ topic_ids: ["trending"] });
    const jev = fakeJev();
    const judge = new TopicJudge(options(jev));
    const plan = planTopicJudging(judge.model, [item], [trending], EMPTY_TOPIC_JUDGMENTS);
    const fresh = await judge.judge(plan.requests);
    expect(jev.calls).toHaveLength(1);
    expect(Object.keys(jev.calls[0]?.questions ?? {})).toEqual(["fit_0"]);
    expect(fresh).toHaveLength(1);

    const neutral = neutralEntry(item, {
      model: DEFAULT_JEV_MODEL,
      questionsHash: QUESTIONS_HASH,
      now: NOW,
    });
    expect(neutral.category_probs.none).toBe(1);
    expect(neutral.flags).toEqual({ hype: 0, sponsored: 0, funding: 0 });
    // Nothing merged it, so the main cache still lacks the item.
    const cache = mergeJudgments({ version: 1, entries: {} }, []);
    const lookup = lookupJudgments(cache, [item], {
      model: DEFAULT_JEV_MODEL,
      questionsHash: QUESTIONS_HASH,
    });
    expect(lookup.misses).toEqual([item]);
  });

  it("sends only the topic questions for an item with a cached main judgment", async () => {
    const item = makeItem({ title: "quantum" });
    const q = topic("quantum");
    const mainJev = fakeJev();
    const entries = await new JevJudge(options(mainJev)).judge([item]);
    const cache = mergeJudgments({ version: 1, entries: {} }, entries);
    const judgeIdentity = { model: DEFAULT_JEV_MODEL, questionsHash: QUESTIONS_HASH };
    expect(lookupJudgments(cache, [item], judgeIdentity).misses).toEqual([]);

    const jev = fakeJev();
    const topicJudge = new TopicJudge(options(jev));
    const plan = planTopicJudging(topicJudge.model, [item], [q], EMPTY_TOPIC_JUDGMENTS);
    await topicJudge.judge(plan.requests);
    expect(Object.keys(jev.calls[0]?.questions ?? {})).toEqual(["fit_0"]);
  });

  it("sends nothing when the topic fit is cached too", async () => {
    const item = makeItem({ title: "quantum" });
    const q = topic("quantum");
    const jev = fakeJev();
    const judge = new TopicJudge(options(jev));
    const first = planTopicJudging(judge.model, [item], [q], EMPTY_TOPIC_JUDGMENTS);
    const fresh = await judge.judge(first.requests);
    const entries = Object.fromEntries(
      fresh.map((e) => [`${e.item_id}:${e.topic_id}:${e.topic_hash}:${e.model}`, e]),
    );
    const second = planTopicJudging(judge.model, [item], [q], { version: 1, entries });
    expect(second.requests).toEqual([]);
    expect(second.hits).toBe(1);
  });
});
