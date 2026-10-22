import { CATEGORIES } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { type HttpClient, HttpError, type RequestOptions } from "../http.js";
import { applyOpsToDocuments } from "./applyDocuments.js";

const PREFERENCES = JSON.stringify({
  profile: "",
  focus: "",
  weights: Object.fromEntries(CATEGORIES.map((category) => [category, 0.5])),
  preferred_keywords: [],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
});

function failingHttp(error: unknown): HttpClient {
  const fail = async () => {
    throw error;
  };
  return { fetchText: fail, getJson: fail, postJson: fail };
}

const addSource = (
  http: HttpClient,
  ops: unknown = { op: "source.add", url: "https://blog.example.com/" },
) =>
  applyOpsToDocuments({
    ops,
    documents: [{ path: "config/preferences.json", content: PREFERENCES, version: 1 }],
    baseFiles: { "config/sources.json": JSON.stringify({ version: 1, sources: [] }) },
    discover: { http },
  });

describe("applyOpsToDocuments: source.add in the function", () => {
  // The bug: the site's own network failing (no answer, a timeout) was answered 400, "the server
  // turned that change down", so the page dropped an address that was fine and never retried it.
  it("is retryable when the lookup fails on our side, and a refusal when the address answers 404", async () => {
    const network = await addSource(failingHttp(new Error("socket hang up")));
    expect(network).toMatchObject({ ok: false, retryable: true });

    const missing = await addSource(
      failingHttp(Object.assign(new Error("HTTP 404"), { status: 404 })),
    );
    expect(missing).toMatchObject({ ok: false, retryable: false });
  });

  // The bugs (D149, review round 2): undici puts ENOTFOUND two causes deep, so an unknown host was a
  // 503 the page kept pending for ever; a probe that timed out while one add succeeded made the next
  // op's refusal retryable; and discovery's own 12 s timeouts and retry outran the 12 s deadline.
  it("refuses an unknown host, and a refusal after a slow probe, and holds every lookup to 4 s", async () => {
    const unknownHost = new HttpError("fetch failed", {
      url: "https://blog.example.com/",
      cause: Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND blog.example.com"), {
          code: "ENOTFOUND",
        }),
      }),
    });
    expect(await addSource(failingHttp(unknownHost))).toMatchObject({
      ok: false,
      retryable: false,
    });

    const asked: (RequestOptions | undefined)[] = [];
    const slowProbe: HttpClient = {
      fetchText: async (url, options) => {
        asked.push(options);
        if (url === "https://blog.example.com/")
          return { url, status: 200, contentType: "text/html", text: "<html><body></body></html>" };
        if (url.endsWith("/feed")) throw new HttpError("timed out", { url });
        throw new HttpError("HTTP 404", { url, status: 404 });
      },
      getJson: async () => ({}),
      postJson: async () => ({}),
    };
    const batch = await addSource(slowProbe, [
      { op: "source.add", url: "https://blog.example.com/" },
      { op: "source.add", url: "https://other.example.com/", topic_ids: ["no_such_topic"] },
    ]);
    expect(batch).toMatchObject({ ok: false, retryable: false });
    expect(asked.length).toBeGreaterThan(1);
    for (const options of asked) expect(options).toMatchObject({ retries: 0, timeoutMs: 4000 });
  });
});
