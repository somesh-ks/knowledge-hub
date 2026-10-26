import { EMPTY_TOPIC_JUDGMENTS, type Topic } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_JEV_MODEL, type JevClientLike } from "../src/judge/jev.js";
import { LLM_QUESTIONS_HASH, QUESTIONS_HASH } from "../src/judge/questions.js";
import {
  judgeTopicsWithCache,
  mergeTopicJudgments,
  pruneTopicJudgments,
  TopicJudge,
  topicJudgmentKey,
  topicsToJudge,
} from "../src/judge/topicJudge.js";
import {
  buildTopicQuestions,
  normalizeFit,
  TOPIC_FIT_LEVELS,
  topicHash,
  topicQuestion,
} from "../src/judge/topicQuestions.js";
import type { JudgeFailure } from "../src/judge/types.js";
import { makeItem } from "./score-factories.js";
import { NO_WAIT } from "./write-fakes.js";

const NOW = new Date("2026-10-07T08:00:00Z");

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

interface Call {
  state: { title: string };
  questions: Record<string, unknown>;
  model?: string;
}

/** A Jev stand-in that answers every fit question with the level its handler picks. */
function fakeJev(
  level: (call: Call, key: string, index: number) => number | "bad" = () => 4,
): JevClientLike & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async systemOne(request) {
      const call = request as unknown as Call;
      calls.push(call);
      const answers: Record<string, unknown> = {};
      Object.keys(call.questions).forEach((key, index) => {
        const value = level(call, key, index);
        answers[key] = value === "bad" ? { type: "nope" } : { type: "score", score: value };
      });
      return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 2 } };
    },
  };
}

const judgeOver = (
  client: JevClientLike,
  extra: Partial<ConstructorParameters<typeof TopicJudge>[0]> = {},
) => new TopicJudge({ client, now: () => NOW, retry: NO_WAIT, ...extra });

describe("the cost gate", () => {
  it("judges a topic only for an item that names a keyword as a whole word", () => {
    const quantum = topic("quantum", { keywords: ["qubit", "error correction"] });
    const hit = makeItem({ title: "A better Qubit design", snippet: "" });
    const phrase = makeItem({ title: "News", snippet: "Progress in error correction at scale." });
    const miss = makeItem({ title: "Qubits everywhere", snippet: "nothing relevant" });
    expect(topicsToJudge(hit, [quantum])).toEqual([quantum]);
    expect(topicsToJudge(phrase, [quantum])).toEqual([quantum]);
    // "qubits" is a different word from "qubit": no substring matching.
    expect(topicsToJudge(miss, [quantum])).toEqual([]);
  });

  it("judges a topic for an item from a source or query tagged with it, whatever the text says", () => {
    const quantum = topic("quantum", { keywords: [] });
    const other = topic("other", { keywords: [] });
    const tagged = makeItem({ title: "Unrelated words", topic_ids: ["quantum"] });
    expect(topicsToJudge(tagged, [quantum, other])).toEqual([quantum]);
  });

  it("asks nothing for an item that matches no topic", async () => {
    const client = fakeJev();
    const result = await judgeTopicsWithCache(
      judgeOver(client),
      [makeItem({ title: "Plain", snippet: "plain" })],
      [topic("quantum")],
    );
    expect(client.calls).toHaveLength(0);
    expect(result.fits).toEqual({});
    expect(result.gated).toBe(0);
  });
});

describe("the question", () => {
  it("asks how well the item fits the topic's name and description, on five levels", () => {
    const question = topicQuestion({ name: "Quantum", description: "Qubits and codes." });
    expect(JSON.stringify(question)).toContain(
      "How well does this item fit Quantum: Qubits and codes.",
    );
    expect(TOPIC_FIT_LEVELS).toHaveLength(5);
  });

  it("builds one question per topic and maps the keys back", () => {
    const { questions, topicByKey } = buildTopicQuestions([topic("a"), topic("b")]);
    expect(Object.keys(questions)).toEqual(["fit_0", "fit_1"]);
    expect([...topicByKey.values()]).toEqual(["a", "b"]);
  });

  it("hashes the name and description only: keywords and section do not matter", () => {
    const base = topic("a");
    const tuned: Topic = { ...base, keywords: ["x"], section_id: "other" };
    expect(topicHash(tuned)).toBe(topicHash(base));
    expect(topicHash({ ...base, name: "Renamed" })).not.toBe(topicHash(base));
    expect(topicHash({ ...base, description: "Changed." })).not.toBe(topicHash(base));
  });

  it("leaves the category questions and their hashes as they were", () => {
    expect(QUESTIONS_HASH).toBe("376720dff5bc");
    expect(LLM_QUESTIONS_HASH).toBe("111cf0cce2c9");
  });

  it("maps an expected level to 0..1", () => {
    expect(normalizeFit(0)).toBe(0);
    expect(normalizeFit(2)).toBe(0.5);
    expect(normalizeFit(4)).toBe(1);
    expect(normalizeFit(9)).toBe(1);
    expect(normalizeFit(Number.NaN)).toBe(0);
  });
});

describe("TopicJudge", () => {
  it("sends one request per item with a question for each topic, and reads the levels back", async () => {
    const client = fakeJev((_call, _key, index) => (index === 0 ? 4 : 2));
    const judge = judgeOver(client);
    const item = makeItem({ title: "qubit and biotech" });
    const entries = await judge.judge([{ item, topics: [topic("qubit"), topic("biotech")] }]);
    expect(client.calls).toHaveLength(1);
    expect(Object.keys(client.calls[0]?.questions ?? {})).toHaveLength(2);
    expect(entries.map((e) => [e.topic_id, e.fit])).toEqual([
      ["qubit", 1],
      ["biotech", 0.5],
    ]);
    expect(entries[0]).toMatchObject({
      item_id: item.id,
      model: DEFAULT_JEV_MODEL,
      judged_at: NOW.toISOString(),
    });
    expect(judge.usage).toEqual({ requests: 1, inputTokens: 10, outputTokens: 2 });
  });

  it("drops only the topic whose answer is malformed", async () => {
    const judge = judgeOver(fakeJev((_c, _k, index) => (index === 0 ? "bad" : 3)));
    const entries = await judge.judge([
      { item: makeItem({ title: "x" }), topics: [topic("a"), topic("b")] },
    ]);
    expect(entries.map((e) => e.topic_id)).toEqual(["b"]);
  });

  it("reports a failed item and keeps going", async () => {
    const failures: JudgeFailure[] = [];
    const client: JevClientLike = {
      async systemOne(request) {
        const state = request.state as { title: string };
        if (state.title === "boom") throw new Error("Jev is down");
        return {
          model: "jev-test",
          answers: { fit_0: { type: "score", score: 4 } },
        };
      },
    };
    const judge = judgeOver(client, { onFailure: (f) => failures.push(f) });
    const good = makeItem({ title: "fine" });
    const bad = makeItem({ title: "boom" });
    const entries = await judge.judge([
      { item: bad, topics: [topic("a")] },
      { item: good, topics: [topic("a")] },
    ]);
    expect(entries.map((e) => e.item_id)).toEqual([good.id]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.itemId).toBe(bad.id);
  });
});

describe("the topic judgment cache", () => {
  const a = topic("alpha");
  const b = topic("beta");
  const item = makeItem({ title: "alpha and beta together" });

  it("answers from the cache the second time and asks nothing", async () => {
    const client = fakeJev();
    const judge = judgeOver(client);
    const first = await judgeTopicsWithCache(judge, [item], [a, b]);
    expect(first).toMatchObject({ hits: 0, asked: 2, gated: 1 });
    expect(client.calls).toHaveLength(1);

    const second = await judgeTopicsWithCache(judge, [item], [a, b], first.cache);
    expect(second).toMatchObject({ hits: 2, asked: 0 });
    expect(client.calls).toHaveLength(1);
    expect(second.fits).toEqual(first.fits);
  });

  it("re-asks only the topic whose name or description changed", async () => {
    const client = fakeJev();
    const judge = judgeOver(client);
    const first = await judgeTopicsWithCache(judge, [item], [a, b]);
    const edited = { ...b, description: "A narrower beta." };
    const again = await judgeTopicsWithCache(judge, [item], [a, edited], first.cache);
    expect(again).toMatchObject({ hits: 1, asked: 1 });
    // The second request carried one question, not two.
    expect(Object.keys(client.calls[1]?.questions ?? {})).toHaveLength(1);
    expect(again.fits[item.id]).toEqual({ alpha: 1, beta: 1 });
  });

  it("does not re-ask when only keywords, weight or section changed", async () => {
    const client = fakeJev();
    const judge = judgeOver(client);
    const first = await judgeTopicsWithCache(judge, [item], [a]);
    const tuned = { ...a, weight: 0.2, section_id: "elsewhere", keywords: ["alpha", "more"] };
    const again = await judgeTopicsWithCache(judge, [item], [tuned], first.cache);
    expect(again.asked).toBe(0);
    expect(client.calls).toHaveLength(1);
  });

  it("keys on the model too", async () => {
    const client = fakeJev();
    const first = await judgeTopicsWithCache(judgeOver(client), [item], [a]);
    const other = judgeOver(client, { model: "jev-1.13.0" });
    const again = await judgeTopicsWithCache(other, [item], [a], first.cache);
    expect(again.asked).toBe(1);
    expect(Object.keys(again.cache.entries)).toHaveLength(2);
  });

  it("reports pairs the judge could not answer", async () => {
    const client: JevClientLike = {
      async systemOne() {
        throw new Error("down");
      },
    };
    const result = await judgeTopicsWithCache(judgeOver(client), [item], [a, b]);
    expect(result).toMatchObject({ asked: 0, unanswered: 2 });
    expect(result.fits).toEqual({});
  });

  it("keys entries by item, topic, topic hash and model, and prunes after 30 days", async () => {
    const result = await judgeTopicsWithCache(judgeOver(fakeJev()), [item], [a]);
    const [key] = Object.keys(result.cache.entries);
    expect(key).toBe(topicJudgmentKey(item.id, "alpha", topicHash(a), DEFAULT_JEV_MODEL));

    const old = mergeTopicJudgments(EMPTY_TOPIC_JUDGMENTS, [
      {
        item_id: "a".repeat(12),
        topic_id: "alpha",
        topic_hash: "h",
        model: "m",
        judged_at: "2026-08-01T00:00:00Z",
        fit: 1,
      },
    ]);
    const merged = mergeTopicJudgments(old, Object.values(result.cache.entries));
    expect(Object.keys(pruneTopicJudgments(merged, NOW).entries)).toEqual([key]);
  });
});
