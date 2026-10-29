import { PGlite } from "@electric-sql/pglite";
import type { Item, Source } from "@singularity/core";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ExtractedText } from "../src/extract/extractText.js";
import type { SourceFetcher } from "../src/fetch/types.js";
import { createHttpClient } from "../src/http.js";
import { INGEST_WINDOW_DAYS, runIngest } from "../src/ingest/ingest.js";
import type { BlobClient } from "../src/publish/blob.js";
import type { SqlClient } from "../src/store/configPaths.js";
import { MAX_ATTEMPTS } from "../src/store/ingestStore.js";
import { fakeFetch, makeItem, makeSource } from "./fetch-helpers.js";

vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** An in-process Postgres standing in for Neon, with no table made in advance. */
function neon(): { sql: SqlClient; db: PGlite } {
  const db = new PGlite();
  open.push(db);
  return {
    db,
    sql: {
      query: async (text, params) =>
        (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
    },
  };
}

function fakeBlob(options: { failFor?: (body: string) => boolean } = {}) {
  const store = new Map<string, string>();
  const client: BlobClient = {
    async put(pathname, body) {
      const text = new TextDecoder().decode(body);
      if (options.failFor?.(text)) throw new Error("store down");
      store.set(pathname, text);
      return { url: `https://blob.example/${pathname}`, pathname };
    },
    async del() {},
    async list() {
      return { blobs: [], hasMore: false };
    },
  };
  return { client, store };
}

const NOW = new Date("2026-10-29T09:00:00Z");
const WINDOW = { from: new Date(NOW.getTime() - INGEST_WINDOW_DAYS * 86_400_000), to: NOW };

const STORIES = [
  makeItem({ url: "https://example.com/one", title: "One", source_id: "feed" }),
  makeItem({ url: "https://example.com/two", title: "Two", source_id: "feed" }),
];

function feed(items: readonly Item[]): SourceFetcher {
  return async () => [...items];
}

const text = (body: string): ExtractedText => ({
  text: body,
  method: "readability",
  truncated: false,
});

function setup(over: { sources?: Source[]; blob?: BlobClient | null } = {}) {
  const db = neon();
  const blob = fakeBlob();
  const run = (extra: Partial<Parameters<typeof runIngest>[0]> = {}, when: Date = NOW) =>
    runIngest({
      sources: over.sources ?? [makeSource({ id: "feed" })],
      window: WINDOW,
      sql: db.sql,
      blob: over.blob === undefined ? blob.client : over.blob,
      fetchDeps: {
        http: createHttpClient({ fetchImpl: fakeFetch({}), sleep: async () => {} }),
        now: () => when,
      },
      now: () => when,
      fetchers: { rss: feed(STORIES) },
      extract: async (item) => text(`Body of ${item.title}`),
      ...extra,
    });
  return { db, blob, run };
}

describe("ingest", () => {
  it("archives a story once however many runs meet it", async () => {
    const { db, blob, run } = setup();
    const first = await run();
    const later = new Date(NOW.getTime() + 8 * 3_600_000);
    const second = await run({}, later);

    expect(first.run).toMatchObject({ fetched: 2, archived: 2, known: 0 });
    expect(second.run).toMatchObject({ fetched: 2, archived: 0, known: 2 });
    expect(blob.store.size).toBe(2);
    const rows = await db.sql.query(
      "select count(*)::int as n, max(last_seen_at) as seen from ingest_items",
    );
    expect(rows[0]?.n).toBe(2);
    expect(new Date(rows[0]?.seen as string).toISOString()).toBe(later.toISOString());
  });

  it("keeps each story's text under a key that does not name its address", async () => {
    const { blob, run } = setup();
    await run();

    const keys = [...blob.store.keys()];
    expect(new Set(keys).size).toBe(2);
    for (const item of STORIES) {
      for (const key of keys) {
        expect(key).not.toContain(item.id);
        expect(key).not.toContain("example");
      }
    }
    const archived = JSON.parse([...blob.store.values()][0] ?? "{}") as Record<string, unknown>;
    expect(archived).toMatchObject({ version: 1, method: "readability" });
  });

  it("never fetches a source type that spends a paid allowance", async () => {
    const paid = vi.fn(async () => [] as Item[]);
    const sources = (["exa", "firecrawl", "youtube"] as const).map((type) =>
      makeSource({ id: type, type }),
    );
    const { run } = setup({ sources: [...sources, makeSource({ id: "feed" })] });
    const result = await run({
      fetchers: { rss: feed(STORIES), exa: paid, firecrawl: paid, youtube: paid },
    });

    expect(paid).not.toHaveBeenCalled();
    expect(result.results.map((r) => r.source_id)).toEqual(["feed"]);
  });

  it("gives up on a page after MAX_ATTEMPTS runs and keeps the rest of the batch", async () => {
    const { db, run } = setup();
    const extract = async (item: Item) => (item.title === "One" ? null : text("Body"));
    for (let attempt = 0; attempt < MAX_ATTEMPTS + 2; attempt++) {
      await run({ extract }, new Date(NOW.getTime() + attempt * 3_600_000));
    }
    const rows = await db.sql.query("select status, attempts from ingest_items order by status");
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([
      ["archived", 1],
      ["unreadable", MAX_ATTEMPTS],
    ]);
  });

  it("does not record a story Blob refused, so the next run tries it again", async () => {
    const { db } = setup();
    const refusing = fakeBlob({ failFor: (body) => body.includes("Body of One") });
    const build = (blob: BlobClient, when: Date) =>
      runIngest({
        sources: [makeSource({ id: "feed" })],
        window: WINDOW,
        sql: db.sql,
        blob,
        fetchDeps: {
          http: createHttpClient({ fetchImpl: fakeFetch({}), sleep: async () => {} }),
          now: () => when,
        },
        now: () => when,
        fetchers: { rss: feed(STORIES) },
        extract: async (item) => text(`Body of ${item.title}`),
      });

    const first = await build(refusing.client, NOW);
    expect(first.run).toMatchObject({ archived: 1, errors: 1 });
    const healthy = fakeBlob();
    const second = await build(healthy.client, new Date(NOW.getTime() + 3_600_000));
    expect(second.run).toMatchObject({ archived: 1, known: 1, errors: 0 });
    expect(healthy.store.size).toBe(1);
  });

  it("changes nothing on a dry run", async () => {
    const { db, blob, run } = setup();
    const result = await run({ dryRun: true });

    expect(result.run.fetched).toBe(2);
    expect(blob.store.size).toBe(0);
    await expect(db.sql.query("select 1 from ingest_items")).rejects.toThrow();
  });
});
