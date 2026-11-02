import { describe, expect, it } from "vitest";
import { type HttpClient, HttpError } from "../src/http.js";
import { cacheForRun } from "../src/httpRunCache.js";

function counting(): { http: HttpClient; calls: string[]; failNext: () => void } {
  const calls: string[] = [];
  let fail = false;
  const answer = <T>(label: string, value: T): T => {
    calls.push(label);
    if (fail) {
      fail = false;
      throw new HttpError("HTTP 503", { status: 503, url: label, retryable: true });
    }
    return value;
  };
  return {
    calls,
    failNext: () => {
      fail = true;
    },
    http: {
      fetchText: async (url) =>
        answer(`GET ${url}`, { url, status: 200, contentType: "", text: "x" }),
      getJson: async (url) => answer(`GET ${url}`, { items: [1] }),
      postJson: async (url, body) => answer(`POST ${url} ${JSON.stringify(body)}`, { items: [1] }),
    },
  };
}

describe("a run reads each address once", () => {
  it("answers the weekly pass's read of a feed from the daily pass's", async () => {
    const { http, calls } = counting();
    const cached = cacheForRun(http);
    await cached.fetchText("https://a.example/feed");
    await cached.fetchText("https://a.example/feed");
    await cached.getJson("https://b.example/api");
    await cached.getJson("https://b.example/api");
    expect(calls).toEqual(["GET https://a.example/feed", "GET https://b.example/api"]);
  });

  it("asks again when the query or the body differs, which is how a pass's window reaches Exa", async () => {
    const { http, calls } = counting();
    const cached = cacheForRun(http);
    await cached.postJson("https://api.exa.ai/search", { from: "daily" });
    await cached.postJson("https://api.exa.ai/search", { from: "weekly" });
    await cached.getJson("https://b.example/api?since=1");
    await cached.getJson("https://b.example/api?since=2");
    expect(calls).toHaveLength(4);
  });

  it("tries a failed read again and never hands one caller's JSON to another to change", async () => {
    const { http, calls, failNext } = counting();
    const cached = cacheForRun(http);
    failNext();
    await expect(cached.getJson("https://b.example/api")).rejects.toBeInstanceOf(HttpError);
    const first = (await cached.getJson("https://b.example/api")) as { items: number[] };
    first.items.push(2);
    const second = (await cached.getJson("https://b.example/api")) as { items: number[] };
    expect(second.items).toEqual([1]);
    expect(calls).toHaveLength(2);
  });

  it("refuses a caller with a smaller size cap, and a caller whose deadline has passed, as the client does", async () => {
    const { http, calls } = counting();
    const cached = cacheForRun(http);
    await cached.fetchText("https://a.example/feed");
    await cached.fetchText("https://a.example/feed", { maxBytes: 10 });
    await cached.fetchText("https://a.example/feed", { signal: AbortSignal.abort() });
    expect(calls).toHaveLength(3);
  });
});
