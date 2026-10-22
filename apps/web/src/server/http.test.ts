import type { ClientFault } from "@dispatch/engine/faults-store";
import { describe, expect, it, vi } from "vitest";
import { answerWithRef, toResponse } from "./http";

describe("toResponse", () => {
  it("writes a JSON body with the status", async () => {
    const response = toResponse({ status: 202, body: { run_id: 1 } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ run_id: 1 });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("is uncacheable and unsniffable by default", () => {
    const response = toResponse({ status: 200, body: {} });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lets a handler set its own cache window and other headers", () => {
    const response = toResponse({
      status: 429,
      body: {},
      headers: { "Cache-Control": "private, max-age=3", "Retry-After": "60" },
    });
    expect(response.headers.get("cache-control")).toBe("private, max-age=3");
    expect(response.headers.get("retry-after")).toBe("60");
  });
});

describe("answerWithRef", () => {
  // A server failure used to reach the page as a bare "unavailable", with nothing to find its log line
  // by, and a thrown error as the host's error page, which read like a passing outage.
  it("ties a server failure to its log lines by a reference, and answers a crash in JSON", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: string) => logs.push(line));
    const failed = await answerWithRef(
      "api/x",
      async (log) => {
        log("GitHub answered 401");
        return { status: 503, body: { status: 503, error: "unavailable" } };
      },
      "3f9a1c",
    );
    expect(await failed.json()).toEqual({ status: 503, error: "unavailable", ref: "3f9a1c" });
    expect(logs).toEqual([
      "[api/x] [ref 3f9a1c] GitHub answered 401",
      "[api/x] [ref 3f9a1c] answered 503 unavailable",
    ]);

    const crashed = await answerWithRef(
      "api/x",
      () => Promise.reject(new TypeError("boom")),
      "0a0b0c",
    );
    expect(crashed.status).toBe(500);
    expect(await crashed.json()).toEqual({ status: 500, error: "server_error", ref: "0a0b0c" });
    expect(
      logs.some((line) => line.startsWith("[api/x] [ref 0a0b0c] crashed: TypeError: boom")),
    ).toBe(true);

    const refused = await answerWithRef("api/x", async () => ({
      status: 401,
      body: { error: "wrong_passphrase" },
    }));
    expect(await refused.json()).toEqual({ error: "wrong_passphrase" });
    spy.mockRestore();
  });

  // A 5xx lived only in a log Hobby keeps an hour (D158). It is kept as a fault, by route label and
  // the start of its message, without ever holding the answer: a store that hangs delays nothing.
  it("keeps a server failure as a fault without waiting on the store", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const kept: ClientFault[] = [];
    const hangs = (fault: ClientFault) => {
      kept.push(fault);
      return new Promise<void>(() => undefined);
    };
    const crashed = await answerWithRef(
      "api/x",
      () => Promise.reject(new TypeError("Cannot read 'secret' of undefined")),
      "0a0b0c",
      hangs,
    );
    expect(crashed.status).toBe(500);
    await answerWithRef(
      "api/x",
      async () => ({ status: 503, body: { error: "unavailable" } }),
      "0a0b0d",
      hangs,
    );
    await answerWithRef("api/x", async () => ({ status: 401, body: {} }), "0a0b0e", hangs);
    expect(kept.map(({ kind, page, message }) => ({ kind, page, message }))).toEqual([
      { kind: "server", page: "api/x", message: "Cannot read" },
      { kind: "server", page: "api/x", message: "status 503" },
    ]);
    spy.mockRestore();
  });
});
