import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Runs the real public/sw.js in a sandbox with a fake Cache API and a fake network, then fires events
 * at it. The service worker is plain JavaScript with no build step, so this is the only place its
 * rules are checked: above all that audio never goes through the cache.
 */

const ORIGIN = "https://news.someshks.work";
const SOURCE = readFileSync(join(import.meta.dirname, "..", "public", "sw.js"), "utf8");
/** The worker's own cache version, so a bump of VERSION in sw.js does not fail this file. */
const CURRENT_VERSION = /const VERSION = "(v\d+)"/.exec(SOURCE)?.[1];

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  destination: string;
  headers: Headers;
}

function request(path: string, overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    url: path.startsWith("http") ? path : `${ORIGIN}${path}`,
    method: "GET",
    mode: "cors",
    destination: "",
    headers: new Headers(),
    ...overrides,
  };
}

function urlOf(key: FakeRequest | string): string {
  if (typeof key !== "string") return key.url;
  return key.startsWith("http") ? key : `${ORIGIN}${key}`;
}

class FakeCache {
  entries = new Map<string, Response>();
  async put(key: FakeRequest | string, response: Response) {
    this.entries.set(urlOf(key), response);
  }
  async match(key: FakeRequest | string) {
    return this.entries.get(urlOf(key))?.clone();
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(key: { url: string }) {
    return this.entries.delete(key.url);
  }
}

class FakeCaches {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    let store = this.stores.get(name);
    if (!store) {
      store = new FakeCache();
      this.stores.set(name, store);
    }
    return store;
  }
  async match(key: FakeRequest | string) {
    for (const store of this.stores.values()) {
      const hit = await store.match(key);
      if (hit) return hit;
    }
    return undefined;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  stored(): string[] {
    return [...this.stores.values()].flatMap((store) => [...store.entries.keys()]);
  }
}

type Handler = (event: Record<string, unknown>) => void;

function load(network: (url: string) => Response | Promise<Response> = () => new Response("ok")) {
  const handlers = new Map<string, Handler>();
  const caches = new FakeCaches();
  const skipWaiting = vi.fn();
  const claim = vi.fn(async () => {});
  const fetched: string[] = [];
  /** The worker's clock, so a test can age a saved page. */
  const clock = { now: 1_700_000_000_000 };
  /** Messages the worker posted to open pages. */
  const posted: unknown[] = [];
  const fakeFetch = async (input: FakeRequest | string) => {
    const url =
      typeof input === "string"
        ? input.startsWith("http")
          ? input
          : `${ORIGIN}${input}`
        : input.url;
    fetched.push(url);
    return network(url);
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting,
    clients: {
      claim,
      matchAll: async () => [{ postMessage: (message: unknown) => posted.push(message) }],
    },
  };
  runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fakeFetch,
    URL,
    Response,
    Headers,
    Promise,
    Set,
    setTimeout,
    Math,
    Array,
    console,
    Date: { now: () => clock.now },
  });

  async function dispatchFetch(req: FakeRequest, preloadResponse?: Promise<Response | undefined>) {
    const waits: Promise<unknown>[] = [];
    let handled: Promise<Response> | undefined;
    handlers.get("fetch")?.({
      request: req,
      preloadResponse,
      respondWith: (promise: Promise<Response>) => {
        handled = promise;
      },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    const response = handled ? await handled : undefined;
    await Promise.all(waits);
    return { handled: handled !== undefined, response };
  }

  async function lifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)?.({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  }

  return { handlers, caches, skipWaiting, claim, fetched, clock, posted, dispatchFetch, lifecycle };
}

describe("service worker: requests it passes straight through", () => {
  // Video, ranged page reads, the API, other methods and other origins are not its business.
  // Each request sits on a path the worker would otherwise serve (/d/, /_astro/, /covers/, a page).
  const ranged = { headers: new Headers({ Range: "bytes=0-1" }) };
  it.each([
    ["video by destination", request("/d/clip", { destination: "video" })],
    ["a Range request, so Safari seeking works", request("/d/2026-10-07", ranged)],
    ["a POST", request("/d/2026-10-07", { method: "POST" })],
    ["a GET to the API, even as a navigation", request("/api/generate", { mode: "navigate" })],
    ["the status API with a query", request("/api/status?run=1", { mode: "navigate" })],
    ["another origin", request("https://example.com/_astro/x.css")],
  ])("%s", async (_name, passing) => {
    const worker = load();
    expect((await worker.dispatchFetch(passing)).handled).toBe(false);
    expect(worker.fetched).toEqual([]);
    expect(worker.caches.stored()).toEqual([]);
  });
});

describe("service worker: what it leaves alone", () => {
  it("never stores /api/narrate, so a narration shows up the moment it exists, and leaves a POST alone", async () => {
    let audioExists = false;
    const worker = load(
      () => new Response(audioExists ? "audio" : "none", { status: audioExists ? 200 : 404 }),
    );
    // A POST spends narration: it always goes straight to the network.
    expect((await worker.dispatchFetch(request("/api/narrate", { method: "POST" }))).handled).toBe(
      false,
    );
    // A lookup for anything not downloaded is not the worker's: it goes straight to the network,
    // before and after the narration exists, and nothing is kept.
    const lookup = request("/api/narrate?digest=2026-10-07", { mode: "navigate" });
    expect((await worker.dispatchFetch(lookup)).handled).toBe(false);
    audioExists = true;
    expect((await worker.dispatchFetch(lookup)).handled).toBe(false);
    expect(worker.caches.stored()).toEqual([]);
  });

  it("does not bring a cached page back for /api/narrate when the network is down and nothing was downloaded", async () => {
    let online = true;
    const worker = load(() => {
      if (!online) throw new TypeError("offline");
      return new Response("page");
    });
    await worker.lifecycle("install");
    online = false;
    // A page request would fall back to /offline here. The API must not.
    const result = await worker.dispatchFetch(request("/api/narrate?digest=2026-10-07"));
    // Either the worker leaves it to the network, or it answers with an error: never a page.
    if (result.handled) expect(result.response?.type).toBe("error");
    expect(await result.response?.text()).not.toBe("page");
  });
});

describe("service worker: caching strategies", () => {
  // A cache entry the browser broke made every load of the file fail, online, until the worker changed.
  it("answers from the network when a cache read throws, and rebuilds its caches", async () => {
    const worker = load();
    await worker.dispatchFetch(request("/_astro/app.abc.css"));
    const name = `singularity-shell-${CURRENT_VERSION}`;
    const broken = await worker.caches.open(name);
    worker.caches.match = async () => {
      throw new Error("corrupt entry");
    };
    const answer = await worker.dispatchFetch(request("/_astro/app.abc.css"));
    expect(answer.response?.status).toBe(200);
    expect(await worker.caches.open(name)).not.toBe(broken);
  });

  // /latest.json is stored under its bare path: probing the request (with its query) never saw the
  // corrupt entry, so it was never healed.
  it("rebuilds its caches when only the saved /latest.json entry is unreadable", async () => {
    let online = true;
    const worker = load(() => {
      if (!online) {
        online = true;
        throw new TypeError("network blip");
      }
      return new Response("{}");
    });
    await worker.dispatchFetch(request("/latest.json?t=1"));
    const name = `singularity-pages-${CURRENT_VERSION}`;
    const broken = await worker.caches.open(name);
    const match = worker.caches.match.bind(worker.caches);
    worker.caches.match = async (key: string | FakeRequest) => {
      if (key === "/latest.json") throw new Error("corrupt entry");
      return match(key);
    };
    online = false;
    const answer = await worker.dispatchFetch(request("/latest.json?t=2"));
    expect(answer.response?.status).toBe(200);
    expect(await worker.caches.open(name)).not.toBe(broken);
  });

  // A dropped connection on an uncached asset once emptied the shell, pages and media caches: the
  // saved briefings the person reads offline went with it.
  it("keeps every saved page when a network blip rejects a strategy and the retry answers", async () => {
    let blip = false;
    const worker = load(() => {
      if (blip) {
        blip = false;
        throw new TypeError("network blip");
      }
      return new Response("body");
    });
    await worker.dispatchFetch(request("/d/2026-10-07"));
    const pages = await worker.caches.open(`singularity-pages-${CURRENT_VERSION}`);
    blip = true;
    const answer = await worker.dispatchFetch(request("/_astro/uncached.abc.js"));
    expect(answer.response?.status).toBe(200);
    expect(await worker.caches.open(`singularity-pages-${CURRENT_VERSION}`)).toBe(pages);
    expect(await pages.match("/d/2026-10-07")).toBeDefined();
  });

  it("serves hashed assets cache first", async () => {
    const worker = load();
    await worker.dispatchFetch(request("/_astro/app.abc.css"));
    const second = await worker.dispatchFetch(request("/_astro/app.abc.css"));
    expect(second.handled).toBe(true);
    expect(worker.fetched).toEqual([`${ORIGIN}/_astro/app.abc.css`]);
  });

  // A briefing's saved page names the old deploy's stylesheets: answered first, it showed the old layout.
  it.each(["/", "/d/2026-10-07"])("goes to the network first for a load of %s", async (path) => {
    let version = 1;
    const worker = load(() => new Response(`page v${version}`));
    await worker.dispatchFetch(request(path, { mode: "navigate" }));
    version = 2;
    const next = await worker.dispatchFetch(request(path, { mode: "navigate" }));
    expect(await next.response?.text()).toBe("page v2");
  });

  // A preload the worker ignores is a second request for the same page and a console warning.
  it("answers a page load from the browser's navigation preload instead of fetching again", async () => {
    const worker = load(() => new Response("fetched"));
    const home = await worker.dispatchFetch(
      request("/", { mode: "navigate" }),
      Promise.resolve(new Response("preloaded")),
    );
    expect(await home.response?.text()).toBe("preloaded");
    const digest = await worker.dispatchFetch(
      request("/d/2026-10-16", { mode: "navigate" }),
      Promise.resolve(new Response("preloaded digest")),
    );
    expect(await digest.response?.text()).toBe("preloaded digest");
    expect(worker.fetched).not.toContain(`${ORIGIN}/`);
    expect(worker.fetched).not.toContain(`${ORIGIN}/d/2026-10-16`);
  });

  it("treats a fetch from the client router as a page, not as an asset", async () => {
    const worker = load(() => new Response("archive"));
    const page = await worker.dispatchFetch(request("/archive", { mode: "cors" }));
    expect(page.handled).toBe(true);
    const asset = await worker.dispatchFetch(request("/unknown.css", { mode: "cors" }));
    expect(asset.handled).toBe(false);
  });

  it("falls back to the cached home page when the network fails", async () => {
    let online = true;
    const worker = load(() => {
      if (!online) throw new TypeError("offline");
      return new Response("home v1");
    });
    await worker.dispatchFetch(request("/", { mode: "navigate" }));
    online = false;
    const offline = await worker.dispatchFetch(request("/", { mode: "navigate" }));
    expect(await offline.response?.text()).toBe("home v1");
  });

  it("serves /offline when a page is neither reachable nor saved", async () => {
    let online = true;
    const worker = load((url) => {
      if (!online) throw new TypeError("offline");
      return new Response(url.endsWith("/offline") ? "offline page" : "page");
    });
    await worker.lifecycle("install");
    online = false;
    const result = await worker.dispatchFetch(request("/d/2030-01-01", { mode: "navigate" }));
    expect(await result.response?.text()).toBe("offline page");
  });

  it("does not store failed responses", async () => {
    const worker = load(() => new Response("gone", { status: 404 }));
    await worker.dispatchFetch(request("/d/2026-10-09"));
    expect(worker.caches.stored()).toEqual([]);
  });
});

describe("service worker: a move inside the app", () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;

  it("answers from a copy saved moments ago without asking the network", async () => {
    const worker = load(() => new Response("library v1"));
    await worker.dispatchFetch(request("/library", { mode: "navigate" }));
    worker.clock.now += 5 * SECOND;
    const move = await worker.dispatchFetch(request("/library"));
    expect(await move.response?.text()).toBe("library v1");
    expect(worker.fetched).toEqual([`${ORIGIN}/library`]);
  });

  it("answers from a recent copy and asks the network behind it", async () => {
    let version = 1;
    const worker = load(() => new Response(`library v${version}`));
    await worker.dispatchFetch(request("/library", { mode: "navigate" }));
    version = 2;
    worker.clock.now += MINUTE;
    const move = await worker.dispatchFetch(request("/library"));
    expect(await move.response?.text()).toBe("library v1");
    expect(worker.posted).toEqual([{ type: "PAGE_CHANGED", path: "/library" }]);
    worker.clock.now += 5 * SECOND;
    const next = await worker.dispatchFetch(request("/library"));
    expect(await next.response?.text()).toBe("library v2");
  });

  it("says nothing when the page behind a recent copy is the same", async () => {
    const worker = load(() => new Response("settings"));
    await worker.dispatchFetch(request("/settings", { mode: "navigate" }));
    worker.clock.now += MINUTE;
    await worker.dispatchFetch(request("/settings"));
    expect(worker.fetched).toHaveLength(2);
    expect(worker.posted).toEqual([]);
  });

  it("waits for the network when the saved copy is old", async () => {
    let version = 1;
    const worker = load(() => new Response(`home v${version}`));
    await worker.dispatchFetch(request("/", { mode: "navigate" }));
    version = 2;
    worker.clock.now += 11 * MINUTE;
    const move = await worker.dispatchFetch(request("/"));
    expect(await move.response?.text()).toBe("home v2");
    expect(worker.posted).toEqual([]);
  });

  it("still waits for the network on a page load, however recent the copy", async () => {
    let version = 1;
    const worker = load(() => new Response(`home v${version}`));
    await worker.dispatchFetch(request("/"));
    version = 2;
    worker.clock.now += 5 * SECOND;
    const loaded = await worker.dispatchFetch(request("/", { mode: "navigate" }));
    expect(await loaded.response?.text()).toBe("home v2");
  });

  it("answers from the recent copy when the network is down", async () => {
    let online = true;
    const worker = load(() => {
      if (!online) throw new TypeError("offline");
      return new Response("library v1");
    });
    await worker.dispatchFetch(request("/library", { mode: "navigate" }));
    online = false;
    worker.clock.now += MINUTE;
    const move = await worker.dispatchFetch(request("/library"));
    expect(await move.response?.text()).toBe("library v1");
    expect(worker.posted).toEqual([]);
  });

  it("treats every saved page as old once /latest.json changes, except briefings", async () => {
    let version = 1;
    const worker = load((url) =>
      url.endsWith("/latest.json")
        ? new Response(`{"id":${version}}`)
        : new Response(`${new URL(url).pathname} v${version}`),
    );
    await worker.dispatchFetch(request("/latest.json"));
    await worker.dispatchFetch(request("/", { mode: "navigate" }));
    await worker.dispatchFetch(request("/d/2026-10-07"));
    worker.clock.now += 5 * SECOND;
    // The same answer changes nothing: the saved home page still answers.
    version = 1;
    await worker.dispatchFetch(request("/latest.json"));
    version = 2;
    expect(await (await worker.dispatchFetch(request("/"))).response?.text()).toBe("/ v1");
    // A new briefing: the home page waits for the network, the briefing keeps its saved copy.
    await worker.dispatchFetch(request("/latest.json"));
    expect(await (await worker.dispatchFetch(request("/"))).response?.text()).toBe("/ v2");
    const briefing = await worker.dispatchFetch(request("/d/2026-10-07"));
    expect(await briefing.response?.text()).toBe("/d/2026-10-07 v1");
  });

  it("saves /latest.json once under its bare path, whatever the query string", async () => {
    let version = 1;
    const worker = load((url) =>
      new URL(url).pathname === "/latest.json"
        ? new Response(`{"id":${version}}`)
        : new Response(`${new URL(url).pathname} v${version}`),
    );
    await worker.dispatchFetch(request("/latest.json?t=1"));
    await worker.dispatchFetch(request("/", { mode: "navigate" }));
    worker.clock.now += 5 * SECOND;
    for (let poll = 2; poll < 6; poll += 1) {
      await worker.dispatchFetch(request(`/latest.json?t=${poll}`));
    }
    const latest = worker.caches.stored().filter((url) => url.includes("/latest.json"));
    expect(latest).toEqual([`${ORIGIN}/latest.json`]);
    // A new briefing under yet another query string still expires the saved home page.
    version = 2;
    await worker.dispatchFetch(request("/latest.json?t=9"));
    expect(await (await worker.dispatchFetch(request("/"))).response?.text()).toBe("/ v2");
  });

  it("keeps an expired page for when the network is down", async () => {
    let online = true;
    let version = 1;
    const worker = load((url) => {
      if (!online) throw new TypeError("offline");
      return url.endsWith("/latest.json")
        ? new Response(`{"id":${version}}`)
        : new Response("library v1");
    });
    await worker.dispatchFetch(request("/latest.json"));
    await worker.dispatchFetch(request("/library", { mode: "navigate" }));
    version = 2;
    await worker.dispatchFetch(request("/latest.json"));
    online = false;
    const move = await worker.dispatchFetch(request("/library"));
    expect(await move.response?.text()).toBe("library v1");
  });

  it("saves the scripts a page names when it saves the page", async () => {
    const worker = load((url) =>
      url.endsWith("/library")
        ? new Response('<script type="module" src="/_astro/libraryPage.abc.js"></script>', {
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        : new Response("export {}"),
    );
    await worker.dispatchFetch(request("/library"));
    expect(worker.caches.stored()).toContain(`${ORIGIN}/_astro/libraryPage.abc.js`);
    // A second save does not fetch the hashed file again.
    worker.clock.now += 11 * 60 * 1000;
    await worker.dispatchFetch(request("/library"));
    expect(worker.fetched.filter((url) => url.endsWith("libraryPage.abc.js"))).toHaveLength(1);
  });
});

describe("service worker: install and update", () => {
  it("precaches the shell and the assets it names", async () => {
    const worker = load((url) => {
      if (url.endsWith("/")) {
        return new Response(
          '<link rel="stylesheet" href="/_astro/app.css"><script type="module" src="/_astro/page.js"></script>',
        );
      }
      if (url.endsWith("/offline")) return new Response("<p>offline</p>");
      if (url.endsWith("app.css")) return new Response('@font-face{src:url("/_astro/font.woff2")}');
      if (url.endsWith("page.js")) return new Response('import"./chunk.js";');
      return new Response("x");
    });
    await worker.lifecycle("install");
    const stored = worker.caches.stored();
    for (const path of [
      "/",
      "/offline",
      "/_astro/app.css",
      "/_astro/font.woff2",
      "/_astro/page.js",
      "/_astro/chunk.js",
    ]) {
      expect(stored).toContain(`${ORIGIN}${path}`);
    }
  });

  // Every deploy renames the hashed files; the cache is only emptied when VERSION changes.
  it("drops hashed files the new shell no longer reaches, so the cache does not grow every deploy", async () => {
    let build = "a";
    const worker = load((url) => {
      if (url.endsWith("/")) {
        return new Response(`<script type="module" src="/_astro/page.${build}.js"></script>`);
      }
      return new Response("x");
    });
    await worker.lifecycle("install");
    build = "b";
    await worker.lifecycle("install");
    const stored = worker.caches.stored();
    expect(stored).toContain(`${ORIGIN}/_astro/page.b.js`);
    expect(stored).not.toContain(`${ORIGIN}/_astro/page.a.js`);
  });

  it("does not take over on install, so an update cannot interrupt playback", async () => {
    const worker = load();
    await worker.lifecycle("install");
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it("takes over only when the page asks", () => {
    const worker = load();
    worker.handlers.get("message")?.({ data: { type: "SKIP_WAITING" } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
    worker.handlers.get("message")?.({ data: { type: "something else" } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("removes caches from older versions and keeps current ones", async () => {
    const worker = load();
    await worker.caches.open("singularity-shell-v0");
    await worker.caches.open("singularity-pages-v0");
    await worker.caches.open("someone-elses-cache");
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    const names = await worker.caches.keys();
    expect(names).not.toContain("singularity-shell-v0");
    expect(names).not.toContain("singularity-pages-v0");
    expect(names).toContain("someone-elses-cache");
    expect(names).toContain(`singularity-shell-${CURRENT_VERSION}`);
    expect(worker.claim).toHaveBeenCalled();
  });
});

describe("service worker: audio the person downloaded", () => {
  const AUDIO = "https://abc.public.blob.vercel-storage.com/audio/2026-10-07.mp3";
  const body = "0123456789";
  async function withDownload() {
    const worker = load(() => new Response("network audio"));
    const cache = await worker.caches.open("singularity-audio-v1");
    await cache.put(AUDIO, new Response(body, { headers: { "content-type": "audio/mpeg" } }));
    // The page tells the worker its downloads changed; the worker reads them before answering.
    const done: Promise<unknown>[] = [];
    worker.handlers.get("message")?.({
      data: { type: "DOWNLOADS_CHANGED" },
      waitUntil: (promise: Promise<unknown>) => done.push(promise),
    });
    await Promise.all(done);
    return worker;
  }
  const ask = (range?: string) =>
    request(AUDIO, {
      destination: "audio",
      ...(range ? { headers: new Headers({ Range: range }) } : {}),
    });

  it("answers a Range request from the saved file with 206 and Content-Range, which seeking needs", async () => {
    const worker = await withDownload();
    for (const [range, text, header] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=7-", "789", "bytes 7-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      ["bytes=8-99", "89", "bytes 8-9/10"],
    ] as const) {
      const { response } = await worker.dispatchFetch(ask(range));
      expect(response?.status).toBe(206);
      expect(await response?.text()).toBe(text);
      expect(response?.headers.get("content-range")).toBe(header);
    }
    expect(worker.fetched).toEqual([]);
  });

  it("answers the whole file without a Range header, and 416 for a range past the end", async () => {
    const worker = await withDownload();
    const whole = (await worker.dispatchFetch(ask())).response;
    expect(whole?.status).toBe(200);
    expect(await whole?.text()).toBe(body);
    const past = (await worker.dispatchFetch(ask("bytes=50-60"))).response;
    expect(past?.status).toBe(416);
    expect(past?.headers.get("content-range")).toBe("bytes */10");
  });

  // Bug it prevents: every seek of a stream the person never downloaded paid a cache lookup and a
  // worker-proxied fetch on the playback path (the review of 2026-10-21).
  it("leaves audio that was not downloaded to the network, unanswered, and keeps nothing", async () => {
    const worker = load(() => new Response("network audio"));
    const { response } = await worker.dispatchFetch(request("/d/2026-10-07.mp3"));
    expect(response).toBeUndefined();
    expect(worker.fetched).toEqual([]);
    expect(worker.caches.stored()).toEqual([]);
  });

  it("keeps the downloads when a new version of the worker takes over", async () => {
    const worker = await withDownload();
    await (await worker.caches.open("singularity-shell-v1")).put("/x", new Response("old"));
    await worker.lifecycle("activate");
    expect(worker.caches.stored()).toContain(AUDIO);
    expect(worker.caches.stored()).not.toContain(`${ORIGIN}/x`);
  });

  // Bug it prevents: the rename (D179) moved the downloads to a new cache name, and the episodes a
  // phone had downloaded would have stopped playing offline.
  it("moves episodes downloaded under the old cache name and still plays them offline", async () => {
    const worker = load(() => {
      throw new TypeError("offline");
    });
    const old = await worker.caches.open("dispatch-audio-v1");
    await old.put(AUDIO, new Response(body, { headers: { "content-type": "audio/mpeg" } }));
    await old.put("/__downloads.json", new Response("[]"));
    await worker.lifecycle("activate");
    expect(await worker.caches.keys()).not.toContain("dispatch-audio-v1");
    const { response } = await worker.dispatchFetch(ask());
    expect(await response?.text()).toBe(body);
  });
});
