import { CATEGORIES } from "@singularity/core";
import { describe, expect, it, vi } from "vitest";
import { type HttpClient, HttpError } from "../http.js";
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
  deadlineMs?: number,
) =>
  applyOpsToDocuments(
    {
      ops,
      documents: [{ path: "config/preferences.json", content: PREFERENCES, version: 1 }],
      baseFiles: { "config/sources.json": JSON.stringify({ version: 1, sources: [] }) },
      discover: { http },
    },
    deadlineMs,
  );

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
  // 503 the page kept pending for ever, and a probe that timed out while one add succeeded made the
  // next op's refusal retryable.
  it("refuses an unknown host, and a refusal after a slow probe", async () => {
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

    const slowProbe: HttpClient = {
      fetchText: async (url) => {
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
    // The bug (2026-10-24): a refused op in a batch was not named, so the page could not tell which
    // of its waiting changes to drop and every later save was refused with it.
    expect(batch).toMatchObject({ ok: false, retryable: false, op_index: 1 });
  });

  // The bugs: discovery's 12 s page fetch outran the function's deadline; then, held to a short fixed
  // timeout, a page slower than that lost its advertised feed and was saved as a paid scrape source.
  it("gives a slow page the time the deadline leaves, and no lookup more than that", async () => {
    const RSS =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Slow</title><link>https://slow.example/</link>' +
      "<item><title>One</title><link>https://slow.example/one</link><pubDate>Mon, 19 Oct 2026 08:00:00 GMT</pubDate></item>" +
      "</channel></rss>";
    const given: number[] = [];
    // The page answers only a request willing to wait the 5 s it takes.
    const slowPage: HttpClient = {
      fetchText: async (url, options) => {
        given.push(options?.timeoutMs ?? Number.POSITIVE_INFINITY);
        if (url === "https://slow.example/") {
          if ((options?.timeoutMs ?? 0) < 5000) throw new HttpError("timed out", { url });
          return {
            url,
            status: 200,
            contentType: "text/html",
            text: '<html><head><link rel="alternate" type="application/rss+xml" href="/feeds/main.xml"></head></html>',
          };
        }
        if (url === "https://slow.example/feeds/main.xml")
          return { url, status: 200, contentType: "application/rss+xml", text: RSS };
        throw new HttpError("HTTP 404", { url, status: 404 });
      },
      getJson: async () => ({}),
      postJson: async () => ({}),
    };
    const deadline = 9000;
    // The clock stands still, so the time the deadline leaves does not depend on the machine.
    vi.useFakeTimers({ toFake: ["Date"] });
    const added = await addSource(
      slowPage,
      { op: "source.add", url: "https://slow.example/" },
      deadline,
    ).finally(() => vi.useRealTimers());
    expect(added.ok && added.documents["config/sources.user.json"]).toContain(
      '"feed_url": "https://slow.example/feeds/main.xml"',
    );
    for (const timeout of given) expect(timeout).toBeLessThanOrEqual(deadline);
  });
});
