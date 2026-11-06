import { describe, expect, it } from "vitest";
import { handleRegenHints } from "./regenHints";

const ORIGIN = "https://news.example";
const ask = (body: unknown, origin: string | null = ORIGIN) => ({
  bodyText: typeof body === "string" ? body : JSON.stringify(body),
  origin,
  expectedOrigin: ORIGIN,
});

describe("handleRegenHints", () => {
  // Each read is a paid Jev call: a request from another site, or past the cap, must not reach it.
  it("asks Jev only for a same-origin comment within the cap, and answers nothing more otherwise", async () => {
    const asked: string[] = [];
    const read = async (comment: string) => {
      asked.push(comment);
      return { length: true, topics: false };
    };
    const open = { read, mayRead: async () => true };

    expect(
      await handleRegenHints(ask({ comment: " it dragged ", categories: ["AI"] }), open),
    ).toEqual({
      status: 200,
      body: { length: true, topics: false, by: "jev" },
    });
    expect(asked).toEqual(["it dragged"]);

    expect(
      (await handleRegenHints(ask({ comment: "x" }, "https://evil.example"), open)).status,
    ).toBe(400);
    expect((await handleRegenHints(ask({ comment: "x".repeat(501) }), open)).status).toBe(400);
    expect((await handleRegenHints(ask({ comment: "  " }), open)).status).toBe(400);
    expect((await handleRegenHints(ask("{"), open)).status).toBe(400);
    expect(asked).toHaveLength(1);

    const capped = await handleRegenHints(ask({ comment: "too long" }), {
      read,
      mayRead: async () => false,
    });
    expect(capped.body).toEqual({ length: false, topics: false, by: "none" });
    const failed = await handleRegenHints(ask({ comment: "too long" }), {
      read: async () => null,
      mayRead: async () => true,
    });
    expect(failed.body).toEqual({ length: false, topics: false, by: "none" });
    expect(asked).toHaveLength(1);
  });

  // Each values read is a paid Haiku call (D371): same origin, within its own cap, and a failure
  // answers "nothing to set" so the sheet carries on.
  it("answers the values only for a same-origin comment within the cap", async () => {
    const asked: string[] = [];
    const readValues = async (comment: string) => {
      asked.push(comment);
      return { length: "shorter" as const, add: ["AI"] };
    };
    const deps = { mayRead: async () => true, readValues, mayReadValues: async () => true };
    const body = { comment: " it dragged ", categories: ["AI"], want: "values" };

    expect((await handleRegenHints(ask(body), deps)).body).toEqual({
      length: "shorter",
      add: ["AI"],
      by: "haiku",
    });
    expect(asked).toEqual(["it dragged"]);
    expect((await handleRegenHints(ask(body, "https://evil.example"), deps)).status).toBe(400);
    const none = { length: null, add: [], by: "none" };
    expect(
      (await handleRegenHints(ask(body), { ...deps, mayReadValues: async () => false })).body,
    ).toEqual(none);
    expect(
      (await handleRegenHints(ask(body), { ...deps, readValues: async () => null })).body,
    ).toEqual(none);
    expect((await handleRegenHints(ask(body), { mayRead: async () => true })).body).toEqual(none);
    expect(asked).toHaveLength(1);
  });
});
