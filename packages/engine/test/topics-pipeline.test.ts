import { rm } from "node:fs/promises";
import {
  type Digest,
  Item,
  itemId,
  type Preferences,
  resolveTopics,
  type SourceStatsFile,
  type Topic,
  type TopicJudgmentsFile,
  TopicsFile,
} from "@dispatch/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TopicJudge } from "../src/judge/topicJudge.js";
import type { JudgedFile } from "../src/run/artifacts.js";
import { serializeTopics } from "../src/topics/store.js";
import { git } from "./git-testRepo.js";
import {
  buildTemplate,
  goodFeeds,
  instantiate,
  makeWorld,
  readDigest,
  readJson,
  runStaged,
  seed,
  type TestRepo,
  WED,
} from "./orchestrator-fixtures.js";
import { realPreferences } from "./score-factories.js";
import { NO_WAIT } from "./write-fakes.js";

let template: string;
let repo: TestRepo;

beforeAll(async () => {
  template = await buildTemplate();
}, 120_000);
afterAll(async () => {
  await rm(template, { recursive: true, force: true, maxRetries: 3 });
});
beforeEach(async () => {
  repo = await instantiate(template);
}, 60_000);
afterEach(async () => {
  await repo.cleanup();
});

const LONG = { timeout: 90_000 };
const DIGEST_PATH = "Digests/2026/10/2026-10-07.md";

const quantum: Topic = {
  id: "quantum_computing",
  name: "Quantum computing",
  description: "Hardware, algorithms and error correction.",
  weight: 0.8,
  enabled: true,
  keywords: ["qubit"],
  section_id: "quantum",
  never_publish: false,
  origin: "custom",
  depth: "fit_only",
};

function topicsText(preferences: Preferences, topic: Topic = quantum): string {
  const base = resolveTopics(null, preferences);
  return serializeTopics(
    TopicsFile.parse({
      ...base,
      sections: [...base.sections, { id: topic.section_id, title: "Quantum computing", order: 7 }],
      topics: [...base.topics, topic],
    }),
  );
}

/** Items the category judge calls "none", which only the custom topic can rescue. */
function qubitItems(count: number): Item[] {
  return Array.from({ length: count }, (_, n) => {
    const url = `https://blog-a.example/qubit-${n + 1}`;
    return Item.parse({
      id: itemId(url),
      url,
      canonical_url: url,
      title: `Qubit milestone ${n + 1}`,
      source_id: "blog-a",
      source_type: "rss",
      published_at: "2026-10-06T08:00:00Z",
      fetched_at: "2026-10-07T05:00:00Z",
      snippet: "judge:none qubit coherence times improve",
    });
  });
}

/** A Jev stand-in that rates every item that mentions a qubit as squarely on topic. */
function qubitJev() {
  const calls: number[] = [];
  const client = {
    async systemOne(request: { state: unknown; questions: Record<string, unknown> }) {
      calls.push(Object.keys(request.questions).length);
      const state = request.state as { title: string; snippet: string };
      const level = /qubit/i.test(`${state.title} ${state.snippet}`) ? 4 : 0;
      return {
        model: "jev-test",
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key) => [key, { type: "score", score: level }]),
        ),
      };
    },
  };
  return { calls, judge: new TopicJudge({ client, now: () => WED, retry: NO_WAIT }) };
}

describe("a run with a custom topic", () => {
  it(
    "judges the gated items, publishes the topic in its own section and records the state",
    LONG,
    async () => {
      const preferences = realPreferences();
      await seed(repo.root, { "config/topics.json": topicsText(preferences) });
      const feeds = goodFeeds(8);
      feeds["blog-a"] = [...(feeds["blog-a"] ?? []), ...qubitItems(7)];
      const jev = qubitJev();
      const world = makeWorld(repo.root, { now: WED, feeds, topicJudge: jev.judge });

      const results = await runStaged(world);
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);

      // The judge stage asked only about items that name the keyword, one request per item.
      // (the pool prefilter may cap a source, so not every one of the seven reaches the judge)
      const asked = jev.calls.length;
      expect(asked).toBeGreaterThanOrEqual(5);
      expect(jev.calls.every((n) => n === 1)).toBe(true);
      expect(results[2]?.report).toMatchObject({
        passes: [
          { topic_items: asked, topic_fresh: asked, topic_cache_hits: 0, topic_unanswered: 0 },
        ],
      });
      const judged = await readJson<JudgedFile>(repo.root, ".cache/run/2026-10-07/judged.json");
      expect(Object.keys(judged.topic_fits ?? {})).toHaveLength(asked);
      expect(Object.values(judged.topic_fits ?? {})[0]).toEqual({ quantum_computing: 1 });

      const digest: Digest = await readDigest(repo.root, DIGEST_PATH);
      const own = digest.items.filter((item) => item.section === "quantum");
      expect(own).toHaveLength(5);
      expect(own.every((item) => item.category === "quantum_computing")).toBe(true);
      expect(
        digest.items
          .filter((item) => item.section === "top")
          .every((i) => i.category !== "quantum_computing"),
      ).toBe(true);
      // Outside the cap: the main sections still hold their own twelve at most.
      expect(digest.items.length - own.length).toBeLessThanOrEqual(12);
      // The headings are written into the digest, in reading order, custom section last.
      expect(Object.keys(digest.section_titles ?? {}).at(-1)).toBe("quantum");
      expect(digest.section_titles?.quantum).toBe("Quantum computing");

      // State: fits cached, counters recorded, both in the one commit.
      const cache = await readJson<TopicJudgmentsFile>(repo.root, "state/topic-judgments.json");
      expect(Object.keys(cache.entries)).toHaveLength(asked);
      const stats = await readJson<SourceStatsFile>(repo.root, "state/source-stats.json");
      expect(stats.sources["blog-a"]).toMatchObject({ window_start: "2026-10-07" });
      expect(stats.sources["blog-a"]?.judged).toBeGreaterThanOrEqual(7);
      expect(stats.sources["blog-a"]?.passed).toBeGreaterThanOrEqual(5);
      expect(stats.sources["blog-a"]?.published).toBeGreaterThanOrEqual(5);
      const changed = git(repo.root, "show", "--name-only", "--format=", "HEAD")
        .split("\n")
        .filter(Boolean);
      expect(changed).toEqual(
        expect.arrayContaining([
          "state/topic-judgments.json",
          "state/source-stats.json",
          DIGEST_PATH,
        ]),
      );
    },
  );

  it(
    "counts items a coverage topic decides alone as judged but not asked, so trust leaves them out",
    LONG,
    async () => {
      const preferences = realPreferences();
      const coverage: Topic = { ...quantum, depth: "coverage" };
      await seed(repo.root, { "config/topics.json": topicsText(preferences, coverage) });
      const feeds = goodFeeds(8);
      // Tagged for the topic and with no category hint: the topic decides them alone.
      const tagged = qubitItems(4).map((item) => ({ ...item, topic_ids: [coverage.id] }));
      feeds["blog-a"] = [...(feeds["blog-a"] ?? []), ...tagged];
      const world = makeWorld(repo.root, { now: WED, feeds, topicJudge: qubitJev().judge });
      expect((await runStaged(world)).map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);

      const judged = await readJson<JudgedFile>(repo.root, ".cache/run/2026-10-07/judged.json");
      const fromA = new Set((feeds["blog-a"] ?? []).map((item) => item.id));
      const neutral = judged.neutral_ids ?? [];
      expect(neutral.length).toBeGreaterThan(0);
      expect(neutral.every((id) => tagged.some((item) => item.id === id))).toBe(true);
      const judgedA = judged.entries.filter((entry) => fromA.has(entry.item_id)).length;
      const stats = await readJson<SourceStatsFile>(repo.root, "state/source-stats.json");
      expect(stats.sources["blog-a"]).toMatchObject({
        judged: judgedA,
        asked: judgedA - neutral.length,
        flagged: 0,
      });
    },
  );

  it("publishes none of it, and asks nothing, when the topic is switched off", LONG, async () => {
    const preferences = realPreferences();
    await seed(repo.root, {
      "config/topics.json": topicsText(preferences, { ...quantum, enabled: false }),
    });
    const feeds = goodFeeds(8);
    feeds["blog-a"] = [...(feeds["blog-a"] ?? []), ...qubitItems(7)];
    const jev = qubitJev();
    const world = makeWorld(repo.root, { now: WED, feeds, topicJudge: jev.judge });
    const results = await runStaged(world);
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(jev.calls).toHaveLength(0);
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest.items.some((item) => item.section === "quantum")).toBe(false);
    expect(digest.section_titles).toBeUndefined();
    const changed = git(repo.root, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean);
    expect(changed).not.toContain("state/topic-judgments.json");
  });

  it(
    "skips custom topics with a warning, and still publishes, when there is no topic judge",
    LONG,
    async () => {
      const preferences = realPreferences();
      await seed(repo.root, { "config/topics.json": topicsText(preferences) });
      const feeds = goodFeeds(8);
      feeds["blog-a"] = [...(feeds["blog-a"] ?? []), ...qubitItems(3)];
      const world = makeWorld(repo.root, { now: WED, feeds });
      const results = await runStaged(world);
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(world.logs.some((line) => line.message.includes("TYPESAFE_API_KEY"))).toBe(true);
      const digest = await readDigest(repo.root, DIGEST_PATH);
      expect(digest.items.some((item) => item.section === "quantum")).toBe(false);
    },
  );
});

describe("a run with no custom topic", () => {
  it(
    "writes the same digest whether config/topics.json is missing or holds only the seed",
    LONG,
    async () => {
      const preferences = realPreferences();
      const feeds = goodFeeds(10);
      const without = makeWorld(repo.root, { now: WED, feeds });
      expect((await runStaged(without)).map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
      const plain = await readDigest(repo.root, DIGEST_PATH);

      const second = await instantiate(template);
      try {
        await seed(second.root, {
          "config/topics.json": serializeTopics(resolveTopics(null, preferences)),
        });
        const world = makeWorld(second.root, {
          now: WED,
          feeds: goodFeeds(10),
          topicJudge: qubitJev().judge,
        });
        expect((await runStaged(world)).map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
        const seeded = await readDigest(second.root, DIGEST_PATH);
        const strip = (digest: Digest) => ({
          ...digest,
          items: digest.items.map(({ id: _id, url: _url, ...rest }) => rest),
        });
        // Item ids come from the feed fixtures, which differ per call only in minted counters.
        expect(strip(seeded).items.map((i) => [i.section, i.category])).toEqual(
          strip(plain).items.map((i) => [i.section, i.category]),
        );
        expect(seeded.section_titles).toBeUndefined();
        expect(plain.section_titles).toBeUndefined();
      } finally {
        await second.cleanup();
      }
    },
  );
});
