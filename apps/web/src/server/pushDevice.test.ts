import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "@singularity/engine/config-paths";
import { MAX_DEVICES } from "@singularity/engine/push-store";
import { afterAll, describe, expect, it, vi } from "vitest";
import { handlePushDevice } from "./pushDevice";

// An in-process Postgres takes over 5 s to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const db = new PGlite();
afterAll(() => db.close());
const sql: SqlClient = {
  query: async (text, params) => (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
};
const deps = {
  database: (async (work: (s: SqlClient) => unknown) => work(sql)) as never,
  now: () => 1,
};
const ORIGIN = "https://news.example";
const KEY = "k".repeat(22);
const endpoint = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

const put = (n: number, wants: { daily: boolean; weekly: boolean }, origin = ORIGIN) =>
  handlePushDevice(
    {
      method: "PUT",
      bodyText: JSON.stringify({
        subscription: { endpoint: endpoint(n), keys: { p256dh: KEY, auth: KEY } },
        ...wants,
      }),
      origin,
      expectedOrigin: ORIGIN,
    },
    deps,
  );

describe("which scheduled podcasts a browser hears about (D284)", () => {
  // The bug it prevents: any address stored (the workflow posting to a made-up host), a crowd of
  // devices, or a switch turned off that leaves the device on the list.
  it("stores a real push address, caps the devices and forgets one that wants nothing", async () => {
    expect((await put(0, { daily: true, weekly: false })).status).toBe(200);
    for (let n = 1; n < MAX_DEVICES; n += 1) await put(n, { daily: true, weekly: true });
    expect((await put(MAX_DEVICES, { daily: true, weekly: true })).status).toBe(409);
    // A device already on the list can still change its mind at the cap.
    expect((await put(0, { daily: false, weekly: true })).status).toBe(200);

    const refused = await handlePushDevice(
      {
        method: "PUT",
        bodyText: JSON.stringify({
          subscription: {
            endpoint: "https://internal.example/x",
            keys: { p256dh: KEY, auth: KEY },
          },
          daily: true,
          weekly: true,
        }),
        origin: ORIGIN,
        expectedOrigin: ORIGIN,
      },
      deps,
    );
    expect([
      refused.status,
      (await put(99, { daily: true, weekly: true }, "https://evil.example")).status,
    ]).toEqual([400, 400]);

    expect((await put(0, { daily: false, weekly: false })).status).toBe(200);
    const left = await sql.query("select count(*)::int as n from push_devices");
    expect(left[0]?.n).toBe(MAX_DEVICES - 1);
  });
});
