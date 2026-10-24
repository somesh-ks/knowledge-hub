import { describe, expect, it, vi } from "vitest";
import { guardedDatabase } from "./database";
import { handleSharePlay, newLinkId, openListenLink, signToken } from "./share";

const SECRET = "a-test-secret-of-enough-length";
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
      secret: SECRET,
      database: guardedDatabase({ databaseUrl: "postgres://test", connect }),
      burst,
      now: () => Date.parse("2026-10-24T12:00:00Z"),
    },
  };
}

describe("share tokens", () => {
  // The bug it prevents: a made-up or altered token reaching Neon, so a scanner costs a query (and
  // wakes the database) per guess, and the shared rate counter fills with strangers' guesses.
  it("refuses a token with a bad HMAC before the cap or the database is asked", async () => {
    const good = signToken(newLinkId(), SECRET);
    const [id = "", mac = ""] = good.split(".");
    // The last character's low bits are spare: flipping one decodes to the same 16 bytes.
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const spare = B64[B64.indexOf(mac.slice(-1)) ^ 1];
    const forged = [
      `${id}.${mac.slice(0, -1)}${spare}`,
      `${id}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`,
      signToken(id, "another-secret-of-enough-length"),
      `${newLinkId()}.${mac}`,
      "not-a-token",
    ];
    for (const token of forged) {
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
    // The real token does go on to the database (here it fails, which answers 503).
    const { connect, deps: d } = deps();
    expect((await openListenLink(good, d)).status).toBe(503);
    expect(connect).toHaveBeenCalled();
  });
});
