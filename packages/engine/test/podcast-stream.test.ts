import { describe, expect, it } from "vitest";
import { StreamInterruptedError } from "../src/llm/errors.js";
import { spokenMs } from "../src/podcast/fit.js";
import { streamedTurns } from "../src/podcast/llmScriptWriter.js";
import { planPodcast } from "../src/podcast/plan.js";
import { generateScript } from "../src/podcast/script.js";
import {
  createStreamPublisher,
  pruneStreams,
  type StreamDoc,
  streamKeyForEpisode,
  streamKeyForRun,
} from "../src/podcast/stream.js";
import type { PodcastStory, ScriptTurn } from "../src/podcast/types.js";
import type { BlobClient } from "../src/publish/blob.js";
import { FakeScriptWriter, itemId, REQUEST, scriptOf } from "./podcast-fixtures.js";
import { captureLog } from "./write-fakes.js";

const STORIES: PodcastStory[] = [1, 2, 3].map((n) => ({
  item_id: itemId(n),
  headline: `Model ${n} ships`,
  summary: `Example Wire reports that model ${n} adds a planner.`,
  source: "Example Wire",
  url: `https://example.com/${n}`,
  section: "ai",
  category: "frontier_model_releases",
}));

const TURNS: ScriptTurn[] = [
  { speaker: "a", text: "Welcome to Singularity." },
  { speaker: "a", text: "Model 1 ships.", item_id: itemId(1) },
];

/** A Blob that records what was written; it can be down, or fail each name's first put. */
function fakeBlob(options: { failPuts?: boolean; failFirst?: boolean } = {}) {
  const store = new Map<string, StreamDoc>();
  const writes = new Map<string, number>();
  const tried = new Set<string>();
  const client: BlobClient = {
    async put(pathname, body) {
      const first = !tried.has(pathname);
      tried.add(pathname);
      if (options.failPuts || (options.failFirst && first)) throw new Error("store down");
      store.set(pathname, JSON.parse(new TextDecoder().decode(body)) as StreamDoc);
      writes.set(pathname, (writes.get(pathname) ?? 0) + 1);
      return { url: `https://blob.example/${pathname}`, pathname };
    },
    async del() {},
    async list() {
      return { blobs: [], hasMore: false };
    },
  };
  return { client, store, writes };
}

const MINUTES_MS = REQUEST.length_minutes * 60_000;

function publisher(client: BlobClient, log?: ReturnType<typeof captureLog>["log"]) {
  return createStreamPublisher({
    client,
    runId: "123",
    episodeId: "ep-20261013-1200",
    request: REQUEST,
    stories: STORIES,
    now: () => new Date("2026-10-13T12:00:00Z"),
    ...(log ? { log } : {}),
  });
}

describe("the live copy of the script", () => {
  it("carries the cover's colour, so the player's placeholder matches the episode before its image exists", async () => {
    const { client, store } = fakeBlob();
    const stream = createStreamPublisher({
      client,
      runId: "123",
      episodeId: "ep-20261013-1200",
      request: REQUEST,
      stories: STORIES,
      cover: { template: "spring", palette: "kelp", seed: 4117 },
      now: () => new Date("2026-10-13T12:00:00Z"),
    });
    await stream.part(TURNS, MINUTES_MS);
    const doc = store.get(streamKeyForEpisode("ep-20261013-1200", "part-1")) as StreamDoc & {
      cover_key?: string;
    };
    expect(doc.cover_key).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("is still written when the cover's palette is unknown, with no colour", async () => {
    const { client, store } = fakeBlob();
    const stream = createStreamPublisher({
      client,
      runId: "123",
      episodeId: "ep-20261013-1200",
      request: REQUEST,
      stories: STORIES,
      cover: { template: "spring", palette: "no-such-palette", seed: 1 },
      now: () => new Date("2026-10-13T12:00:00Z"),
    });
    await stream.part(TURNS, MINUTES_MS);
    const doc = store.get(streamKeyForEpisode("ep-20261013-1200", "part-1")) as StreamDoc & {
      cover_key?: string;
    };
    expect(doc.turns).toHaveLength(TURNS.length);
    expect(doc.cover_key).toBeUndefined();
  });

  // 2026-11-04: an object written again was served from the CDN as it was for up to a minute, so
  // the player sat silent after the opening, and Blob's list is as stale. Each part is a name of its
  // own, written once. The player adds turns by their place, so a part that moves one is refused.
  it("writes each part once under a new name, and refuses one that does not start with the last", async () => {
    const { client, store, writes } = fakeBlob();
    const { log, lines } = captureLog();
    const stream = publisher(client, log);
    void stream.part(TURNS.slice(0, 1), MINUTES_MS);
    void stream.part([{ speaker: "a", text: "Hello again." }, ...TURNS], MINUTES_MS);
    void stream.part(TURNS, MINUTES_MS);
    await stream.done();
    for (const key of [streamKeyForEpisode, streamKeyForRun]) {
      const id = key === streamKeyForRun ? "123" : "ep-20261013-1200";
      expect(store.get(key(id, "part-1"))?.turns).toHaveLength(1);
      expect(store.get(key(id, "part-2"))?.turns).toEqual(TURNS);
      expect(store.get(key(id, "part-3"))).toBeUndefined();
      expect(store.get(key(id, "done"))?.status).toBe("done");
      expect(store.get(key(id, "done"))?.turns).toEqual(TURNS);
    }
    expect([...writes.values()].every((count) => count === 1)).toBe(true);
    expect(lines.some((line) => line.level === "warn" && line.data?.part === 2)).toBe(true);
  });

  it("marks the document failed, so the player stops waiting for turns that will not come", async () => {
    const { client, store } = fakeBlob();
    const stream = publisher(client);
    await stream.part(TURNS, MINUTES_MS);
    await stream.failed();
    expect(store.get(streamKeyForRun("123", "failed"))?.status).toBe("failed");
    expect(store.get(streamKeyForRun("123", "failed"))?.turns).toHaveLength(2);
  });

  it("tries a failed write once more, and never fails the run when the store is down", async () => {
    // A part that is not written leaves a gap the reader stops at until the episode is done.
    const flaky = fakeBlob({ failFirst: true });
    await publisher(flaky.client).part(TURNS, MINUTES_MS);
    expect(flaky.store.get(streamKeyForEpisode("ep-20261013-1200", "part-1"))?.turns).toEqual(
      TURNS,
    );
    expect(flaky.store.get(streamKeyForRun("123", "part-1"))?.turns).toEqual(TURNS);
    const { client } = fakeBlob({ failPuts: true });
    const stream = publisher(client);
    await expect(stream.part(TURNS, MINUTES_MS)).resolves.toBeUndefined();
    await expect(stream.done()).resolves.toBeUndefined();
  });

  it("removes only streams older than a day", async () => {
    const deleted: string[] = [];
    const now = new Date("2026-10-13T12:00:00Z");
    const client: BlobClient = {
      put: async () => ({ url: "", pathname: "" }),
      del: async (paths) => void deleted.push(...paths),
      list: async () => ({
        hasMore: false,
        blobs: [
          {
            url: "",
            pathname: "streams/old.json",
            uploadedAt: new Date("2026-10-11T00:00:00Z"),
            size: 1,
          },
          {
            url: "",
            pathname: "streams/new.json",
            uploadedAt: new Date("2026-10-13T11:00:00Z"),
            size: 1,
          },
        ],
      }),
    };
    await pruneStreams(client, now);
    expect(deleted).toEqual(["streams/old.json"]);
  });
});

describe("the first part of a script", () => {
  const budget = planPodcast(REQUEST).budget_chars;

  // The parts are counted in the reply's turns, so a turn read wrongly while it streams would make
  // the finished script repeat or lose one.
  it("reads each turn of the streamed reply once it closes, whatever its text holds", () => {
    const reply = {
      turns: [
        { speaker: "a", text: 'Welcome to Singularity. He said "}{" [twice] \\', item_id: null },
        { speaker: "b", text: "Model 1 ships.", item_id: itemId(1) },
      ],
    };
    const text = JSON.stringify(reply);
    const seen: number[] = [];
    let rows: readonly unknown[] = [];
    const read = streamedTurns((next) => {
      seen.push(next.length);
      rows = next;
    });
    for (let at = 0; at < text.length; at += 7) read(text.slice(at, at + 7));
    expect(seen).toEqual([1, 2]);
    expect(rows).toEqual(reply.turns);
  });

  // Owner, 2026-11-04: once Listen now starts it never pauses, and a line heard live is final. The
  // player adds turns by their place, so a list that moved a turn would skip or repeat speech.
  it("goes out as the reply streams, and a reply that breaks off is carried on, not written again", async () => {
    let clock = 0;
    const parts: Array<{ turns: readonly ScriptTurn[]; ms: number }> = [];
    const writer = new FakeScriptWriter((i, call) => {
      const whole = scriptOf(i).turns;
      if (call > 0) return { turns: [...(i.opening ?? []), ...whole.slice(4)] };
      // The first two stories arrive, then the connection drops.
      for (let count = 1; count <= 4; count++) i.onTurns?.(whole.slice(0, count));
      throw new StreamInterruptedError("podcast_script: the reply broke off after it began");
    });
    const result = await generateScript({
      writer,
      request: REQUEST,
      stories: STORIES,
      budget_chars: budget,
      now: () => (clock += 10_000),
      onPart: async (turns, ms) => void parts.push({ turns: turns.slice(), ms }),
    });
    const first = parts[0]?.turns ?? [];
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first[0]?.text).toMatch(/Singularity/);
    expect(first.some((turn) => turn.item_id !== undefined)).toBe(true);
    for (const [index, part] of parts.entries()) {
      const before = parts[index - 1]?.turns ?? [];
      expect(part.turns.slice(0, before.length)).toEqual(before);
    }
    expect(writer.calls[1]?.input.opening?.length).toBeGreaterThan(first.length);
    expect(new Set(result.turns.map((turn) => turn.text)).size).toBe(result.turns.length);
    // The length picked stands until the finished script gives its own.
    expect(parts.at(-1)).toEqual({ turns: result.turns, ms: spokenMs(result.turns) });
    expect(parts.slice(0, -1).every((part) => part.ms === MINUTES_MS)).toBe(true);
  });

  // A first part the checks emptied still counted its rows as taken, so the reply was judged
  // without its opening and every attempt failed for not naming the show.
  it("does not go out until it names the show, and a first part the checks empty leaves the reply whole", async () => {
    let parts = 0;
    const writer = new FakeScriptWriter((i, call) => {
      const whole = scriptOf(i).turns;
      return {
        turns: call === 0 ? [{ speaker: "a", text: "Hello there." }, ...whole.slice(1)] : whole,
      };
    });
    const result = await generateScript({
      writer,
      request: REQUEST,
      stories: STORIES,
      budget_chars: budget,
      onPart: async () => {
        parts += 1;
      },
    });
    // Nothing of the first reply went out, so the retry is a whole script, named first.
    expect(writer.calls[1]?.input.opening).toBeUndefined();
    expect(result.turns[0]?.text).toMatch(/Singularity/);
    expect(parts).toBeGreaterThan(0);

    // The hello, the rundown and the first story make the first part; none survives the checks.
    const invented = new FakeScriptWriter((i) => ({
      turns: scriptOf(i).turns.map((turn, index) =>
        index < 3 ? { ...turn, text: `${turn.text} 8888.` } : turn,
      ),
    }));
    const kept = await generateScript({
      writer: invented,
      request: REQUEST,
      stories: STORIES,
      budget_chars: budget,
      now: () => 0,
      onPart: async () => {},
    });
    expect(invented.calls).toHaveLength(1);
    expect(kept.turns[0]?.text).toMatch(/Singularity/);
  });
});
