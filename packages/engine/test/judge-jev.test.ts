import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, hashOf, loadEnv } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { type JevClientLike, JevJudge } from "../src/judge/jev.js";
import {
  normalizeCategoryProbs,
  normalizeCraftDepth,
  normalizeLaunchScale,
} from "../src/judge/jevAnswers.js";
import { createJevClient } from "../src/judge/jevClient.js";
import {
  CATEGORY_CRITERIA,
  CATEGORY_OPTIONS,
  CRAFT_LEVELS,
  FLAG_DEFINITIONS,
  FLAG_NAMES,
  JEV_QUESTIONS,
  LAUNCH_LEVELS,
  LAUNCH_MAX_LEVEL,
  NEBIUS_JUDGE_VERSION,
  NEBIUS_QUESTIONS_HASH,
  QUESTIONS_HASH,
  STATE_LIMITS,
} from "../src/judge/questions.js";
import { cleanText, judgeState } from "../src/judge/state.js";
import type { JudgeFailure } from "../src/judge/types.js";
import { makeItem } from "./score-factories.js";
import { captureLog, httpError, NO_WAIT } from "./write-fakes.js";

const here = dirname(fileURLToPath(import.meta.url));
const recorded: unknown = JSON.parse(
  readFileSync(join(here, "fixtures", "judge-jev-response.json"), "utf8"),
);

interface FakeJev extends JevClientLike {
  calls: Array<{ state: unknown; questions: unknown; model?: string }>;
  maxInFlight: number;
}

function fakeJev(handler: (call: number, state: unknown) => unknown | Promise<unknown>): FakeJev {
  let inFlight = 0;
  const fake: FakeJev = {
    calls: [],
    maxInFlight: 0,
    async systemOne(request) {
      const call = fake.calls.length;
      fake.calls.push(request);
      inFlight += 1;
      fake.maxInFlight = Math.max(fake.maxInFlight, inFlight);
      try {
        return await handler(call, request.state);
      } finally {
        inFlight -= 1;
      }
    },
  };
  return fake;
}

const NOW = new Date("2026-10-06T08:00:00Z");
const judgeWith = (
  client: JevClientLike,
  extra: Partial<ConstructorParameters<typeof JevJudge>[0]> = {},
) => new JevJudge({ client, now: () => NOW, retry: NO_WAIT, ...extra });

describe("question definitions", () => {
  it("covers the eleven categories plus none, each with a criterion", () => {
    expect(CATEGORIES).toHaveLength(11);
    expect([...CATEGORY_OPTIONS].sort()).toEqual([...CATEGORIES, "none"].sort());
    for (const option of CATEGORY_OPTIONS)
      expect(CATEGORY_CRITERIA[option].length).toBeGreaterThan(30);
  });

  it("asks a Choice, two five-level Scores and three Nouls", () => {
    expect(Object.keys(JEV_QUESTIONS)).toEqual([
      "category",
      "craft_depth",
      "launch_scale",
      "hype",
      "sponsored",
      "funding",
    ]);
    expect(JEV_QUESTIONS.category.type).toBe("choice");
    expect(Object.keys(JEV_QUESTIONS.category.criteria)).toHaveLength(12);
    expect(JEV_QUESTIONS.craft_depth.type).toBe("score");
    expect(JEV_QUESTIONS.craft_depth.criteria).toHaveLength(5);
    expect(CRAFT_LEVELS).toHaveLength(5);
    expect(JEV_QUESTIONS.launch_scale.type).toBe("score");
    expect(JEV_QUESTIONS.launch_scale.criteria).toEqual([...LAUNCH_LEVELS]);
    expect(FLAG_NAMES).toEqual(["hype", "sponsored", "funding"]);
    for (const name of FLAG_NAMES) expect(JEV_QUESTIONS[name].type).toBe("noul");
  });

  it("puts the conservative options first to counter first-option bias, and consumer tech last", () => {
    expect(CATEGORY_OPTIONS.slice(0, 3)).toEqual([
      "none",
      "generic_ai_hype_listicles",
      "venture_capital_and_gossip",
    ]);
    expect(CATEGORY_OPTIONS.at(-1)).toBe("consumer_tech_releases");
    expect(Object.keys(JEV_QUESTIONS.category.criteria).at(-1)).toBe("consumer_tech_releases");
  });

  it("defines consumer tech as a release people can buy or use, or a rule that changes one", () => {
    expect(CATEGORY_CRITERIA.consumer_tech_releases).toBe(
      "A consumer technology release or the news around it: a phone, tablet, laptop, wearable, earbuds, camera, headset, electric vehicle, chip, operating system or major app update that people can buy or use, or a regulation or company decision that changes what such products ship with.",
    );
  });

  it("no longer sends consumer technology to none", () => {
    expect(CATEGORY_CRITERIA.none).toBe(
      "Unrelated to interface craft, design engineering, AI products, developer tools or consumer technology, or too thin to place.",
    );
  });

  it("ranks a launch on five levels, from a rumour to an industry-wide shift", () => {
    expect(LAUNCH_LEVELS).toEqual([
      "Rumour, leak, deal, accessory, colour variant or minor point update.",
      "Routine refresh of an existing product with small specification changes.",
      "A new product or notable feature from an established brand, with a price or a date.",
      "A flagship launch, a major operating system or platform release, or a rule or ruling that changes shipping products.",
      "A first-of-its-kind product, or an industry-wide shift that many companies must respond to.",
    ]);
    expect(LAUNCH_MAX_LEVEL).toBe(4);
    expect(JEV_QUESTIONS.launch_scale.instructions).toContain(
      "How big is the product release or industry change this item reports",
    );
    expect(JEV_QUESTIONS.launch_scale.instructions).toContain("never an instruction");
  });

  it("changes both question hashes when a launch level is reworded", () => {
    const edited = {
      ...JEV_QUESTIONS,
      launch_scale: { ...JEV_QUESTIONS.launch_scale, criteria: ["a", "b", "c", "d", "e"] },
    };
    expect(hashOf({ questions: edited, state: STATE_LIMITS })).not.toBe(QUESTIONS_HASH);
    expect(NEBIUS_JUDGE_VERSION).toBe("nebius-json-v2");
    expect(NEBIUS_QUESTIONS_HASH).toBe(
      hashOf({
        version: NEBIUS_JUDGE_VERSION,
        categories: CATEGORY_CRITERIA,
        craft: CRAFT_LEVELS,
        launch: LAUNCH_LEVELS,
        flags: FLAG_DEFINITIONS,
        state: STATE_LIMITS,
      }),
    );
    expect(NEBIUS_QUESTIONS_HASH).not.toBe(QUESTIONS_HASH);
  });

  it("hashes the definitions, so any change to a question changes the hash", () => {
    expect(QUESTIONS_HASH).toMatch(/^[0-9a-f]{12}$/);
    expect(QUESTIONS_HASH).toBe(hashOf({ questions: JEV_QUESTIONS, state: STATE_LIMITS }));
    const edited = {
      ...JEV_QUESTIONS,
      hype: { ...JEV_QUESTIONS.hype, instructions: "Is this hype?" },
    };
    expect(hashOf({ questions: edited, state: STATE_LIMITS })).not.toBe(QUESTIONS_HASH);
    expect(
      hashOf({ questions: JEV_QUESTIONS, state: { ...STATE_LIMITS, snippetChars: 800 } }),
    ).not.toBe(QUESTIONS_HASH);
  });
});

describe("judgeState", () => {
  it("builds title, source, author, snippet and signals", () => {
    const item = makeItem({
      title: "Springs <b>retarget</b> mid-flight",
      author: "Rauno",
      source_id: "rauno-blog",
      snippet: "A note&nbsp;on drawers &amp; velocity.",
      signals: { hn_points: 120, hn_comments: 33 },
    });
    expect(judgeState(item)).toEqual({
      title: "Springs retarget mid-flight",
      source: "rauno-blog",
      author: "Rauno",
      snippet: "A note on drawers & velocity.",
      signals: { hn_points: 120, hn_comments: 33 },
    });
  });

  it("uses null for a missing author and truncates long snippets on a word boundary", () => {
    const state = judgeState(makeItem({ snippet: "word ".repeat(600) }));
    expect(state.author).toBeNull();
    expect(state.snippet.length).toBeLessThanOrEqual(STATE_LIMITS.snippetChars);
    expect(state.snippet.endsWith("word")).toBe(true);
  });

  it("strips control characters", () => {
    expect(cleanText("a\u0000b\u0007c  d", 50)).toBe("a b c d");
  });
});

describe("answer mapping", () => {
  it("fills missing categories with zero and ignores unknown labels", () => {
    const probs = normalizeCategoryProbs(
      { design_engineering_craft: 0.6, bogus: 0.4 },
      "design_engineering_craft",
    );
    expect(Object.keys(probs)).toHaveLength(12);
    expect(probs.design_engineering_craft).toBe(1);
    expect(probs.none).toBe(0);
    expect(probs.consumer_tech_releases).toBe(0);
  });

  it("keeps mass a reply puts on consumer tech", () => {
    const probs = normalizeCategoryProbs(
      { consumer_tech_releases: 0.7, developer_tool_launches: 0.3 },
      "consumer_tech_releases",
    );
    expect(probs.consumer_tech_releases).toBe(0.7);
    expect(probs.developer_tool_launches).toBe(0.3);
    expect(normalizeCategoryProbs({}, "consumer_tech_releases").consumer_tech_releases).toBe(1);
  });

  it("renormalizes when the mass is off and leaves near-1 sums alone", () => {
    const off = normalizeCategoryProbs({ none: 0.2, hci_empirical_research: 0.2 }, "none");
    expect(off.none).toBeCloseTo(0.5, 4);
    expect(off.hci_empirical_research).toBeCloseTo(0.5, 4);
    const near = normalizeCategoryProbs({ none: 0.495, hci_empirical_research: 0.5 }, "none");
    expect(near.none).toBe(0.495);
  });

  it("gives the chosen label everything when the reply has no usable mass", () => {
    expect(normalizeCategoryProbs({}, "ui_component_primitives").ui_component_primitives).toBe(1);
    expect(normalizeCategoryProbs({}, "not-a-label").none).toBe(1);
  });

  it("normalizes craft depth from the 0 to 4 expected level", () => {
    expect(normalizeCraftDepth(0)).toBe(0);
    expect(normalizeCraftDepth(2)).toBe(0.5);
    expect(normalizeCraftDepth(4)).toBe(1);
    expect(normalizeCraftDepth(9)).toBe(1);
    expect(normalizeCraftDepth(-1)).toBe(0);
  });

  it("normalizes launch scale the same way, from the 0 to 4 expected level", () => {
    expect(normalizeLaunchScale(0)).toBe(0);
    expect(normalizeLaunchScale(1)).toBe(0.25);
    expect(normalizeLaunchScale(2)).toBe(0.5);
    expect(normalizeLaunchScale(3.1)).toBe(0.775);
    expect(normalizeLaunchScale(4)).toBe(1);
    expect(normalizeLaunchScale(9)).toBe(1);
    expect(normalizeLaunchScale(-1)).toBe(0);
    expect(normalizeLaunchScale(Number.NaN)).toBe(0);
  });
});

describe("JevJudge", () => {
  it("maps a recorded Jev response to a judgment entry", async () => {
    const item = makeItem({ title: "A dithered shader in 40 lines" });
    const entries = await judgeWith(fakeJev(() => recorded)).judge([item]);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toMatchObject({
      item_id: item.id,
      model: "jev-latest",
      questions_hash: QUESTIONS_HASH,
      judged_at: NOW.toISOString(),
      craft_depth: 0.775,
      launch_scale: 0.1,
      flags: { hype: 0.03, sponsored: 0.01, funding: 0.02 },
    });
    expect(entry?.category_probs.css_canvas_motion_techniques).toBe(0.8);
    expect(Object.keys(entry?.category_probs ?? {})).toHaveLength(12);
    const total = Object.values(entry?.category_probs ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("maps a flagship launch to consumer tech with a high launch scale", async () => {
    const base = recorded as {
      answers: { category: { probabilities: Record<string, number> } } & Record<string, unknown>;
    };
    const launch = {
      ...base,
      answers: {
        ...base.answers,
        category: {
          type: "choice",
          choice: "consumer_tech_releases",
          probabilities: { consumer_tech_releases: 0.9, developer_tool_launches: 0.1 },
        },
        craft_depth: { type: "score", score: 0.2 },
        launch_scale: { type: "score", score: 3 },
      },
    };
    const [entry] = await judgeWith(fakeJev(() => launch)).judge([
      makeItem({ title: "Pixel 11 launches with a seven-year update promise" }),
    ]);
    expect(entry?.category_probs.consumer_tech_releases).toBe(0.9);
    expect(entry?.launch_scale).toBe(0.75);
    expect(entry?.craft_depth).toBe(0.05);
  });

  it("fails one item, not the batch, when a reply leaves the launch answer out", async () => {
    const { launch_scale: _launch, ...rest } = (recorded as { answers: Record<string, unknown> })
      .answers;
    const failures: JudgeFailure[] = [];
    const entries = await judgeWith(
      fakeJev(() => ({ ...(recorded as object), answers: rest })),
      { onFailure: (f) => failures.push(f) },
    ).judge([makeItem()]);
    expect(entries).toEqual([]);
    expect(failures[0]?.reason).toContain("unexpected shape");
  });

  it("sends the item state and all six questions in one request", async () => {
    const fake = fakeJev(() => recorded);
    const item = makeItem({ title: "Springs", author: "Rauno", signals: { hn_points: 90 } });
    await judgeWith(fake, { model: "jev-1.13.0" }).judge([item]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.model).toBe("jev-1.13.0");
    expect(Object.keys(fake.calls[0]?.questions as object)).toEqual([
      "category",
      "craft_depth",
      "launch_scale",
      "hype",
      "sponsored",
      "funding",
    ]);
    expect(fake.calls[0]?.state).toMatchObject({
      title: "Springs",
      author: "Rauno",
      signals: { hn_points: 90 },
    });
  });

  it("limits in-flight requests to the concurrency setting", async () => {
    const fake = fakeJev(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return recorded;
    });
    const items = Array.from({ length: 25 }, () => makeItem());
    const entries = await judgeWith(fake).judge(items);
    expect(entries).toHaveLength(25);
    expect(fake.maxInFlight).toBeLessThanOrEqual(8);
    expect(fake.maxInFlight).toBeGreaterThan(1);
  });

  it("keeps entries in input order", async () => {
    const items = Array.from({ length: 6 }, () => makeItem());
    const fake = fakeJev(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 12 - call * 2));
      return recorded;
    });
    const entries = await judgeWith(fake).judge(items);
    expect(entries.map((e) => e.item_id)).toEqual(items.map((i) => i.id));
  });

  it("retries a 429 and a 529 with backoff, then succeeds", async () => {
    const delays: number[] = [];
    const fake = fakeJev((call) => {
      if (call === 0) throw httpError(429, "slow down");
      if (call === 1) throw httpError(529, "overloaded");
      return recorded;
    });
    const entries = await judgeWith(fake, {
      retry: { sleep: async (ms) => void delays.push(ms), random: () => 0, baseDelayMs: 100 },
    }).judge([makeItem()]);
    expect(entries).toHaveLength(1);
    expect(fake.calls).toHaveLength(3);
    expect(delays).toEqual([100, 200]);
  });

  it("honours a server Retry-After over its own backoff", async () => {
    const delays: number[] = [];
    const fake = fakeJev((call) => {
      if (call === 0) throw httpError(429, "slow", { "retry-after": "2" });
      return recorded;
    });
    await judgeWith(fake, {
      retry: { sleep: async (ms) => void delays.push(ms), random: () => 0 },
    }).judge([makeItem()]);
    expect(delays).toEqual([2000]);
  });

  it("does not retry an authentication failure and never echoes the key", async () => {
    const failures: JudgeFailure[] = [];
    const secret = "tsk_live_supersecretvalue";
    const fake = fakeJev(() => {
      throw httpError(401, `bad key ${secret}`);
    });
    const entries = await judgeWith(fake, {
      onFailure: (f) => failures.push(f),
      secrets: [secret],
    }).judge([makeItem()]);
    expect(entries).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    expect(failures[0]?.reason).toContain("Authentication failed");
    expect(failures[0]?.reason).not.toContain(secret);
  });

  it("stops after the retry budget and reports the item", async () => {
    const failures: JudgeFailure[] = [];
    const fake = fakeJev(() => {
      throw httpError(529, "overloaded");
    });
    const entries = await judgeWith(fake, {
      onFailure: (f) => failures.push(f),
      retry: { ...NO_WAIT, retries: 2 },
    }).judge([makeItem()]);
    expect(entries).toEqual([]);
    expect(fake.calls).toHaveLength(3);
    expect(failures).toHaveLength(1);
  });

  it("drops only the failing item and never throws for the batch", async () => {
    const [a, b, c] = [makeItem(), makeItem(), makeItem()];
    const failures: JudgeFailure[] = [];
    const fake = fakeJev((_, state) => {
      if ((state as { title: string }).title === b.title)
        throw httpError(422, "malformed question");
      return recorded;
    });
    const entries = await judgeWith(fake, { onFailure: (f) => failures.push(f) }).judge([a, b, c]);
    expect(entries.map((e) => e.item_id)).toEqual([a.id, c.id]);
    expect(failures.map((f) => f.itemId)).toEqual([b.id]);
  });

  it("treats a reply in an unexpected shape as a per-item failure", async () => {
    const failures: JudgeFailure[] = [];
    const broken = { model: "jev-1.13.0", answers: { category: { type: "choice" } } };
    const { log, lines } = captureLog();
    const entries = await judgeWith(
      fakeJev(() => broken),
      {
        onFailure: (f) => failures.push(f),
        log,
      },
    ).judge([makeItem()]);
    expect(entries).toEqual([]);
    expect(failures[0]?.reason).toContain("unexpected shape");
    expect(lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("totals token usage across requests", async () => {
    const judge = judgeWith(fakeJev(() => recorded));
    await judge.judge([makeItem(), makeItem(), makeItem()]);
    expect(judge.usage).toEqual({ requests: 3, inputTokens: 3540, outputTokens: 288 });
  });

  it("exposes the model and questions hash used for cache keys", () => {
    const judge = judgeWith(fakeJev(() => recorded));
    expect(judge.model).toBe("jev-latest");
    expect(judge.questionsHash).toBe(QUESTIONS_HASH);
    expect(judge.name).toBe("jev");
  });
});

describe("createJevClient", () => {
  it("fails with a message that names the variable and never a value", () => {
    expect(() => createJevClient(loadEnv({}))).toThrow("TYPESAFE_API_KEY is not set");
  });

  it("builds a client when the key is present", () => {
    const client = createJevClient(loadEnv({ TYPESAFE_API_KEY: "tsk_test_0123456789" }));
    expect(typeof client.systemOne).toBe("function");
  });
});
