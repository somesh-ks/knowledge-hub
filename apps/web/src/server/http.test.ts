import type { ClientFault } from "@singularity/engine/faults-store";
import type { APIRoute } from "astro";
import { describe, expect, it, vi } from "vitest";
import { type ApiResult, answerWithRef, recordingFaults, toResponse } from "./http";

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

/** A writer that keeps what it is given and never settles: a store that hangs must delay nothing. */
function hangingWriter() {
  const kept: ClientFault[] = [];
  const record = (fault: ClientFault) => {
    kept.push(fault);
    return new Promise<void>(() => undefined);
  };
  return { kept, record, said: () => kept.map((fault) => `${fault.page} ${fault.message}`) };
}

describe("answerWithRef", () => {
  // A server failure used to reach the page as a bare "unavailable", with nothing to find its log line
  // by, and a thrown error as the host's error page, which read like a passing outage.
  it("ties a server failure to its log lines by a reference, and answers a crash in JSON", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: string) => logs.push(line));
    const { record } = hangingWriter();
    const failed = await answerWithRef(
      "api/x",
      async (log) => {
        log("GitHub answered 401");
        return { status: 503, body: { status: 503, error: "unavailable" } };
      },
      "3f9a1c",
      record,
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
      record,
    );
    expect(crashed.status).toBe(500);
    expect(await crashed.json()).toEqual({ status: 500, error: "server_error", ref: "0a0b0c" });
    expect(
      logs.some((line) => line.startsWith("[api/x] [ref 0a0b0c] crashed: TypeError: boom")),
    ).toBe(true);

    const refused = await answerWithRef(
      "api/x",
      async () => ({ status: 400, body: { error: "invalid_request" } }),
      undefined,
      record,
    );
    expect(await refused.json()).toEqual({ error: "invalid_request" });
    spy.mockRestore();
  });

  // A 5xx lived only in a log Hobby keeps an hour (D158). It is kept by route label and what names
  // the step (a returned code, or a throw's start with secrets redacted), one a minute per route,
  // never holding the answer, and a throwing getter or a bare `throw undefined` cannot change it.
  it("keeps a server failure as a fault, naming the step, without waiting or leaking", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { record, said } = hangingWriter();
    const token = "ghp_abcdefghijklmnopqrstuvwxyzABCD";
    const answer = (route: string, run: () => Promise<ApiResult<unknown>>) =>
      answerWithRef(route, run, "0a0b0c", record);
    expect((await answer("api/a", () => Promise.reject(new Error(`Bad ${token}`)))).status).toBe(
      500,
    );
    await answer("api/b", async () => ({ status: 503, body: { error: "synthesis_failed" } }));
    await answer("api/b", async () => ({ status: 503, body: { error: "synthesis_failed" } }));
    await answer("api/c", async () => ({ status: 502, body: { error: "Not A Code 1" } }));
    await answer("api/d", () => Promise.reject(undefined));
    const getter = new Error("x");
    Object.defineProperty(getter, "message", {
      get() {
        throw new Error("getter");
      },
    });
    expect((await answer("api/e", () => Promise.reject(getter))).status).toBe(500);
    await answer("api/f", async () => ({ status: 401, body: {} }));
    await vi.waitFor(() => expect(said()).toHaveLength(5));
    expect(said()).toEqual([
      "api/a Bad [redacted]",
      "api/b synthesis_failed",
      "api/c status 502",
      "api/d thrown",
      "api/e thrown",
    ]);
    expect(said().join(" ")).not.toContain("ghp_");
    spy.mockRestore();
  });
});

describe("recordingFaults", () => {
  // The routes that answer for themselves (a stream, their own body) kept no 5xx at all (D158). The
  // wrapper keeps one, returns the answer unchanged, rethrows a throw and never waits on the store; a
  // route fetching a host the caller chose keeps only its own 500.
  it("keeps a returned 5xx or a throw, leaves the answer as it was, and never waits", async () => {
    const { record, said } = hangingWriter();
    const context = {} as Parameters<APIRoute>[0];
    const run = (route: string, handler: APIRoute, ours?: (status: number) => boolean) =>
      recordingFaults(route, handler, { record, ...(ours ? { ours } : {}) })(context);
    const failed = Response.json({ error: "synthesis_failed" }, { status: 502 });
    expect(await run("api/a", () => failed)).toBe(failed);
    expect(await failed.json()).toEqual({ error: "synthesis_failed" });
    expect((await run("api/b", () => new Response("ok"))).status).toBe(200);
    await expect(
      run("api/c", () => Promise.reject(new Error("Speechify timed out"))),
    ).rejects.toThrow("Speechify timed out");
    await run("api/d", () => new Response("upstream", { status: 504 }));
    await run(
      "api/e",
      () => new Response("upstream", { status: 502 }),
      (status) => status === 500,
    );
    await vi.waitFor(() => expect(said()).toHaveLength(3));
    expect(said()).toEqual([
      "api/a synthesis_failed",
      "api/c Speechify timed out",
      "api/d status 504",
    ]);
  });
});
