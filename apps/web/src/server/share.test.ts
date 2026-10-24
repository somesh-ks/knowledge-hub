import type { SqlClient } from "@dispatch/engine/config-paths";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { BlobEntry } from "./blobStore";
import { type DatabaseCall, guardedDatabase } from "./database";
import {
  createNotStoredMemo,
  handleShare,
  handleSharePlay,
  type MakeDeps,
  NOT_STORED_MEMO_MS,
  newLinkId,
  openListenLink,
  type ShareCandidate,
} from "./share";

// An in-process Postgres takes over 5 s to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const ORIGIN = "https://news.someshks.work";

/** The real guarded database with a connect that counts: any query at all would call it. */
function deps() {
  const connect = vi.fn(async () => ({
    query: async () => {
      throw new Error("no database in this test");
    },
  }));
  const burst = vi.fn(async () => 0);
  return {
    connect,
    burst,
    deps: {
      database: guardedDatabase({ databaseUrl: "postgres://test", connect }),
      burst,
      now: () => Date.parse("2026-10-24T12:00:00Z"),
      candidates: async () => [],
    },
  };
}

describe("share tokens", () => {
  // The bug it prevents: a malformed token reaching Neon, so a scanner costs a query (and wakes the
  // database) per guess, and the shared rate counter fills with strangers' junk.
  it("refuses a malformed token before the cap or the database is asked", async () => {
    const good = newLinkId();
    // The last character's low bits are spare: flipping one decodes to the same 16 bytes.
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const spare = B64[B64.indexOf(good.slice(-1)) ^ 1];
    const malformed = [
      `${good.slice(0, -1)}${spare}`,
      good.slice(1),
      `${good}A`,
      `${good.slice(0, -1)}.`,
      `${good}.${good}`,
      "not-a-token",
      "",
    ];
    for (const token of malformed) {
      const { connect, burst, deps: d } = deps();
      expect(await openListenLink(token, d), token).toEqual({ status: 404, reason: "not_found" });
      const play = await handleSharePlay(
        { bodyText: JSON.stringify({ token }), origin: ORIGIN, expectedOrigin: ORIGIN },
        d,
      );
      expect(play.status, token).toBe(404);
      expect(connect, token).not.toHaveBeenCalled();
      expect(burst, token).not.toHaveBeenCalled();
    }
    // A well-formed token does go on to the database (here it fails, which answers 503).
    const { connect, deps: d } = deps();
    expect((await openListenLink(good, d)).status).toBe(503);
    expect(connect).toHaveBeenCalled();
  });
});

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

describe("a shared link and its item", () => {
  // The bugs it prevents: after a Regenerate (same id) the link kept the old files, so a listener
  // heard the old audio under the new text, and after a Delete it kept playing the deleted item;
  // and a Share retried on half-stored audio headed every file in Blob on every press.
  it("stops when its item is regenerated or deleted, and a retried Share heads nothing", async () => {
    const db = new PGlite();
    open.push(db);
    const sql: SqlClient = {
      query: async (text, params) =>
        (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
    };
    const database: DatabaseCall = (work) => work(sql);
    const item = "2026-10-07";
    let files: ShareCandidate[] | null = [{ pathname: "audio/a-v1.mp3", characters: 900 }];
    const stored = new Set(["audio/a-v1.mp3"]);
    const head = vi.fn(
      async (pathname: string): Promise<BlobEntry | null> =>
        stored.has(pathname)
          ? ({
              url: `https://s.public.blob.vercel-storage.com/${pathname}`,
              size: 16_000,
            } as BlobEntry)
          : null,
    );
    let now = Date.parse("2026-10-24T12:00:00Z");
    const deps: MakeDeps = {
      database,
      burst: async () => 0,
      now: () => now,
      candidates: async () => files,
      head,
      notStored: createNotStoredMemo(),
    };
    const share = async () =>
      handleShare(
        {
          method: "POST",
          bodyText: JSON.stringify({ item }),
          origin: ORIGIN,
          expectedOrigin: ORIGIN,
        },
        deps,
      );
    const play = async (token: unknown) =>
      handleSharePlay(
        { bodyText: JSON.stringify({ token }), origin: ORIGIN, expectedOrigin: ORIGIN },
        deps,
      );

    const first = (await share()).body.token;
    expect((await play(first)).status).toBe(200);
    // A well-formed token nobody made: not found, by the play route and the page.
    expect((await play(newLinkId())).status).toBe(404);
    expect((await openListenLink(newLinkId(), deps)).status).toBe(404);

    // Regenerated: new words, so new files, not yet stored.
    files = [{ pathname: "audio/a-v2.mp3", characters: 950 }];
    expect((await play(first)).status).toBe(410);
    expect((await openListenLink(String(first), deps)).status).toBe(410);
    expect((await share()).status).toBe(409);
    const heads = head.mock.calls.length;
    expect((await share()).status).toBe(409);
    expect(head.mock.calls.length).toBe(heads);

    // Played once in the app, so stored; once the memo lapses, Share makes a new link.
    stored.add("audio/a-v2.mp3");
    now += NOT_STORED_MEMO_MS + 1;
    const second = (await share()).body.token;
    expect(second).not.toBe(first);
    const granted = await play(second);
    expect(granted.body.segments).toEqual([
      {
        url: "https://s.public.blob.vercel-storage.com/audio/a-v2.mp3",
        duration_ms: expect.any(Number),
      },
    ]);

    // Deleted: the link stops, and the play it was granted is handed back to the month.
    const spent = (await sql.query("select bytes from share_budget"))[0]?.bytes;
    files = null;
    expect((await play(second)).status).toBe(410);
    expect((await sql.query("select bytes from share_budget"))[0]?.bytes).toBe(spent);
  });
});
