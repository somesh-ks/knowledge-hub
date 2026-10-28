import { describe, expect, it } from "vitest";
import { planPodcast } from "../src/podcast/plan.js";
import { generateScript } from "../src/podcast/script.js";
import {
  createStreamPublisher,
  pruneStreams,
  type StreamDoc,
  streamKeyForEpisode,
  streamKeyForRun,
} from "../src/podcast/stream.js";
import type { PodcastStory, ScriptInput, ScriptTurn } from "../src/podcast/types.js";
import type { BlobClient } from "../src/publish/blob.js";
import { FakeScriptWriter, itemId, REQUEST, scriptOf } from "./podcast-fixtures.js";

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

/** A Blob that records what was written, and can hold the first write back. */
function fakeBlob(options: { slowFirst?: boolean; failPuts?: boolean } = {}) {
  const store = new Map<string, StreamDoc>();
  const order: string[] = [];
  let puts = 0;
  const client: BlobClient = {
    async put(pathname, body) {
      const mine = puts++;
      if (options.failPuts) throw new Error("store down");
      if (options.slowFirst && mine < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      const doc = JSON.parse(new TextDecoder().decode(body)) as StreamDoc;
      order.push(`${doc.status}:${doc.turns.length}`);
      store.set(pathname, doc);
      return { url: `https://blob.example/${pathname}`, pathname };
    },
    async del() {},
    async list() {
      return { blobs: [], hasMore: false };
    },
  };
  return { client, store, order };
}

function publisher(client: BlobClient) {
  return createStreamPublisher({
    client,
    runId: "123",
    episodeId: "ep-20261013-1200",
    request: REQUEST,
    stories: STORIES,
    now: () => new Date("2026-10-13T12:00:00Z"),
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
    await stream.opening(TURNS);
    const doc = store.get(streamKeyForEpisode("ep-20261013-1200")) as StreamDoc & {
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
    await stream.opening(TURNS);
    const doc = store.get(streamKeyForEpisode("ep-20261013-1200")) as StreamDoc & {
      cover_key?: string;
    };
    expect(doc.turns).toHaveLength(TURNS.length);
    expect(doc.cover_key).toBeUndefined();
  });

  it("lands in the order it was written, so a slow opening cannot cut a finished script back", async () => {
    const { client, store } = fakeBlob({ slowFirst: true });
    const stream = publisher(client);
    void stream.opening(TURNS.slice(0, 2));
    void stream.script([...TURNS, { speaker: "a", text: "That is all." }]);
    await stream.done();
    for (const key of [streamKeyForEpisode("ep-20261013-1200"), streamKeyForRun("123")]) {
      expect(store.get(key)?.status).toBe("done");
      expect(store.get(key)?.turns).toHaveLength(3);
    }
  });

  it("marks the document failed, so the player stops waiting for turns that will not come", async () => {
    const { client, store } = fakeBlob();
    const stream = publisher(client);
    await stream.opening(TURNS);
    await stream.failed();
    expect(store.get(streamKeyForRun("123"))?.status).toBe("failed");
    expect(store.get(streamKeyForRun("123"))?.turns).toHaveLength(2);
  });

  it("never fails the run when the store is down", async () => {
    const { client } = fakeBlob({ failPuts: true });
    const stream = publisher(client);
    await expect(stream.opening(TURNS)).resolves.toBeUndefined();
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

describe("the opening of a script", () => {
  const input = (): ScriptInput => ({
    request: REQUEST,
    stories: STORIES,
    budget_chars: planPodcast(REQUEST).budget_chars,
  });

  class OpeningWriter extends FakeScriptWriter {
    constructor(private readonly opening: unknown) {
      super((i) => {
        const whole = scriptOf(i).turns;
        return { turns: i.opening ? [...i.opening, ...whole.slice(1)] : whole };
      });
    }
    async writeOpening(): Promise<unknown> {
      return this.opening;
    }
  }

  const run = (writer: OpeningWriter, seen: string[]) =>
    generateScript({
      writer,
      request: REQUEST,
      stories: STORIES,
      budget_chars: input().budget_chars,
      onOpening: async (turns) => void seen.push(`opening:${turns.length}`),
    });

  it("is handed over before the rest is written, and the script continues after it", async () => {
    const seen: string[] = [];
    const writer = new OpeningWriter({ turns: TURNS });
    const result = await run(writer, seen);
    expect(seen).toEqual(["opening:2"]);
    expect(writer.calls[0]?.input.opening).toHaveLength(2);
    expect(result.turns.slice(0, 2).map((turn) => turn.text)).toEqual(TURNS.map((t) => t.text));
  });

  it("is dropped when it does not name the show, instead of being spoken", async () => {
    const seen: string[] = [];
    const writer = new OpeningWriter({
      turns: [
        { speaker: "a", text: "Hello there." },
        { speaker: "a", text: "Model 1 ships.", item_id: itemId(1) },
      ],
    });
    await run(writer, seen);
    expect(seen).toEqual([]);
    expect(writer.calls[0]?.input.opening).toBeUndefined();
  });
});
