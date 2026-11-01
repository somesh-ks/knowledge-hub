import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "@singularity/engine/config-paths";
import { readPushKeys } from "@singularity/engine/push-store";
import { afterAll, describe, expect, it, vi } from "vitest";
import { REPO } from "../testing/fakeGitHub";
import { cancelTokenFor } from "./cancelToken";
import { handlePushKey, handlePushWatch } from "./pushWatch";

// An in-process Postgres takes over 5 s to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const TOKEN = "github_pat_secret_value_123456";
const env = {
  GITHUB_SINGULARITY_TOKEN: TOKEN,
  GITHUB_REPOSITORY: REPO,
};
const ORIGIN = "https://news.example";
const KEY = "k".repeat(22);

const db = new PGlite();
afterAll(() => db.close());
const sql: SqlClient = {
  query: async (text, params) => (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
};
const deps = {
  env,
  database: (async (work: (s: SqlClient) => unknown) => work(sql)) as never,
  now: () => 1,
};

function post(overrides: Record<string, unknown> = {}, token = cancelTokenFor(TOKEN, 4242)) {
  return handlePushWatch(
    {
      method: "POST",
      bodyText: JSON.stringify({
        run_id: 4242,
        cancel_token: token,
        kind: "catch_up",
        subscription: {
          endpoint: "https://fcm.googleapis.com/fcm/send/abc",
          keys: { p256dh: KEY, auth: KEY },
        },
        ...overrides,
      }),
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
    },
    deps,
  );
}

describe("watching a run for a push (D284)", () => {
  // The bug it prevents: a stranger's address stored against a run they did not start (so the owner's
  // runs ping them), or an address that is not a push service (the workflow posting to any URL).
  it("stores a watch only with the run's token and a real push address", async () => {
    expect((await post()).status).toBe(200);
    expect((await sql.query("select run_id from push_watches")).length).toBe(1);

    const refused = [
      await post({}, cancelTokenFor(TOKEN, 1)),
      await post({}, "0".repeat(64)),
      await post({
        subscription: { endpoint: "https://internal.example/x", keys: { p256dh: KEY, auth: KEY } },
      }),
      await post({ kind: "delete" }),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 403, 400, 400]);
    expect((await sql.query("select run_id from push_watches")).length).toBe(1);

    const other = await handlePushWatch(
      { method: "POST", bodyText: "{}", origin: "https://evil.example", expectedOrigin: ORIGIN },
      deps,
    );
    expect(other.status).toBe(400);
  });

  // The bug it prevents: two browsers (or a browser and the workflow) holding different keys, so
  // every message is refused by the push service.
  it("makes the key pair once and answers the same public key every time", async () => {
    const first = await handlePushKey(deps);
    const again = await handlePushKey(deps);
    expect(first.status).toBe(200);
    expect(again).toEqual(first);
    expect(await sql.query("select 1 from push_keys")).toHaveLength(1);
    expect((await readPushKeys(sql))?.publicKey).toBe(
      (first.body as { public_key: string }).public_key,
    );
  });
});
