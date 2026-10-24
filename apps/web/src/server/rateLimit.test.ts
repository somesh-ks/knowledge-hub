import type { SqlClient } from "@singularity/engine/config-paths";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATABASE_TIMEOUT_MS } from "./database";
import { createSharedLimiter } from "./rateLimit";

afterEach(() => {
  vi.useRealTimers();
});

describe("createSharedLimiter", () => {
  // The bug it prevents, both ways: a counter that is down (an error, no table, a database that does
  // not answer) must neither fail the request nor wave it through past the instance's own cap.
  it("falls back to the instance's own cap when the counter errors or hangs, and asks it again later", async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    let mode: "error" | "hang" | "full" = "error";
    const queries: string[] = [];
    const sql: SqlClient = {
      query: (text) => {
        queries.push(mode);
        if (mode === "error") return Promise.reject(new Error("relation does not exist"));
        if (mode === "hang") return new Promise(() => {});
        return Promise.resolve([{ count: 99 }]);
      },
    };
    const take = createSharedLimiter({
      databaseUrl: "postgres://user:secret@db.invalid/neondb",
      connect: async () => sql,
      now: () => now,
      log: () => {},
    });

    expect(await take("emoji", 2)).toBe(true);
    // Backed off after the error: the instance counts alone, and its own cap still holds.
    expect(await take("emoji", 2)).toBe(true);
    expect(await take("emoji", 2)).toBe(false);
    expect(queries).toEqual(["error"]);

    now += 60_000;
    mode = "hang";
    const pending = take("emoji", 2);
    await vi.advanceTimersByTimeAsync(DATABASE_TIMEOUT_MS);
    expect(await pending).toBe(true);

    now += 60_000;
    mode = "full";
    expect(await take("emoji", 2)).toBe(false);
    expect(queries).toEqual(["error", "hang", "full"]);
  });
});
