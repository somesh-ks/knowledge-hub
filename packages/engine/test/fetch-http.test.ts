import { describe, expect, it } from "vitest";
import {
  createHttpClient,
  HttpError,
  isRetryableStatus,
  parseRetryAfter,
  safeUrl,
  USER_AGENT,
} from "../src/http.js";

const noSleep = async (): Promise<void> => {};

function sequence(responses: (() => Response)[]): { fetchImpl: typeof fetch; calls: () => number } {
  let index = 0;
  return {
    fetchImpl: (async () => {
      const make = responses[Math.min(index, responses.length - 1)];
      index++;
      if (!make) throw new Error("no response");
      return make();
    }) as typeof fetch,
    calls: () => index,
  };
}

describe("http client", () => {
  it("retries a 503 with exponential backoff and jitter, then succeeds", async () => {
    const delays: number[] = [];
    const { fetchImpl, calls } = sequence([
      () => new Response("down", { status: 503 }),
      () => new Response("down", { status: 502 }),
      () => new Response("ok", { status: 200 }),
    ]);
    const http = createHttpClient({
      fetchImpl,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
      baseDelayMs: 100,
    });
    const response = await http.fetchText("https://example.com/feed");
    expect(response.text).toBe("ok");
    expect(calls()).toBe(3);
    // 100 * 2^0 + 50 jitter, then 100 * 2^1 + 50 jitter.
    expect(delays).toEqual([150, 250]);
  });

  it("honors Retry-After in seconds on a 429", async () => {
    const delays: number[] = [];
    const { fetchImpl } = sequence([
      () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
      () => new Response("ok"),
    ]);
    const http = createHttpClient({
      fetchImpl,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await http.fetchText("https://example.com/x");
    expect(delays).toEqual([3000]);
  });

  it("stops retrying when Retry-After is longer than the cap", async () => {
    const { fetchImpl, calls } = sequence([
      () => new Response("", { status: 429, headers: { "retry-after": "600" } }),
    ]);
    const http = createHttpClient({ fetchImpl, sleep: noSleep, maxRetryAfterMs: 20_000 });
    await expect(http.fetchText("https://example.com/x")).rejects.toMatchObject({ status: 429 });
    expect(calls()).toBe(1);
  });

  it("does not retry client errors", async () => {
    const { fetchImpl, calls } = sequence([() => new Response("nope", { status: 404 })]);
    const http = createHttpClient({ fetchImpl, sleep: noSleep });
    await expect(http.fetchText("https://example.com/missing")).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
      retryable: false,
    });
    expect(calls()).toBe(1);
  });

  it("gives up after the configured retries and reports the last status", async () => {
    const { fetchImpl, calls } = sequence([() => new Response("", { status: 500 })]);
    const http = createHttpClient({ fetchImpl, sleep: noSleep, retries: 2 });
    await expect(http.fetchText("https://example.com/x")).rejects.toMatchObject({ status: 500 });
    expect(calls()).toBe(3);
  });

  it("retries network failures", async () => {
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt++;
      if (attempt < 2) throw new TypeError("fetch failed");
      return new Response("fine");
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl, sleep: noSleep });
    expect((await http.fetchText("https://example.com/x")).text).toBe("fine");
    expect(attempt).toBe(2);
  });

  it("sends a descriptive User-Agent", async () => {
    let seen: Headers | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response("ok");
    }) as typeof fetch;
    await createHttpClient({ fetchImpl }).fetchText("https://example.com/x");
    expect(seen?.get("user-agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toContain("Dispatch");
  });

  it("rejects a body larger than the cap, declared or streamed", async () => {
    const declared = createHttpClient({
      fetchImpl: (async () =>
        new Response("x", { headers: { "content-length": "9999999" } })) as typeof fetch,
      maxBytes: 1000,
    });
    await expect(declared.fetchText("https://example.com/big")).rejects.toThrow(/larger than/);

    const streamed = createHttpClient({
      fetchImpl: (async () => new Response("y".repeat(5000))) as typeof fetch,
      maxBytes: 1000,
    });
    await expect(streamed.fetchText("https://example.com/big")).rejects.toThrow(/larger than/);
  });

  it("parses JSON and reports invalid JSON as an HttpError", async () => {
    const ok = createHttpClient({
      fetchImpl: (async () => new Response('{"a":1}')) as typeof fetch,
    });
    expect(await ok.getJson("https://example.com/j")).toEqual({ a: 1 });
    const bad = createHttpClient({
      fetchImpl: (async () => new Response("<html>")) as typeof fetch,
    });
    await expect(bad.getJson("https://example.com/j")).rejects.toBeInstanceOf(HttpError);
  });

  it("posts JSON with a content type and merges custom headers", async () => {
    let captured: { body?: unknown; headers?: Headers; method?: string } = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = { body: init?.body, headers: new Headers(init?.headers), method: init?.method };
      return new Response('{"ok":true}');
    }) as typeof fetch;
    const http = createHttpClient({ fetchImpl });
    await http.postJson(
      "https://api.example.com/search",
      { q: "x" },
      { headers: { "x-api-key": "k" } },
    );
    expect(captured.method).toBe("POST");
    expect(captured.body).toBe('{"q":"x"}');
    expect(captured.headers?.get("content-type")).toBe("application/json");
    expect(captured.headers?.get("x-api-key")).toBe("k");
  });

  it("times out a request that never answers", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const http = createHttpClient({ fetchImpl, sleep: noSleep, timeoutMs: 20, retries: 0 });
    await expect(http.fetchText("https://example.com/hang")).rejects.toThrow(/timed out/);
  });

  it("keeps query strings out of error messages", async () => {
    const http = createHttpClient({
      fetchImpl: (async () => new Response("", { status: 404 })) as typeof fetch,
    });
    const error = await http
      .fetchText("https://example.com/p?mailto=me@example.com")
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(JSON.stringify([error.message, error.url])).not.toContain("mailto");
  });
});

describe("http helpers", () => {
  it("classifies retryable statuses", () => {
    expect([429, 500, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([200, 301, 400, 401, 403, 404, 410].some(isRetryableStatus)).toBe(false);
  });

  it("parses Retry-After as seconds or as an HTTP date", () => {
    expect(parseRetryAfter("7")).toBe(7000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
    const now = Date.parse("2026-10-06T10:00:00Z");
    expect(parseRetryAfter("Tue, 06 Oct 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("Tue, 06 Oct 2026 09:00:00 GMT", now)).toBe(0);
  });

  it("strips the query from URLs in messages", () => {
    expect(safeUrl("https://a.example/path?token=1#x")).toBe("https://a.example/path");
    expect(safeUrl("not a url at all")).toBe("not a url at all");
  });
});
