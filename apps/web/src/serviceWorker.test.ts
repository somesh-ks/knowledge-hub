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

class FakeCache {
  entries = new Map<string, Response>();
  async put(key: FakeRequest | string, response: Response) {
    this.entries.set(typeof key === "string" ? `${ORIGIN}${key}` : key.url, response);
  }
  async match(key: FakeRequest | string) {
    return this.entries.get(typeof key === "string" ? `${ORIGIN}${key}` : key.url)?.clone();
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

  async function dispatchFetch(req: FakeRequest) {
    const waits: Promise<unknown>[] = [];
    let handled: Promise<Response> | undefined;
    handlers.get("fetch")?.({
      request: req,
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
  // Audio is never cached or touched; the API, other methods and other origins are not its business.
  // Each request sits on a path the worker would otherwise serve (/d/, /_astro/, /covers/, a page).
  const ranged = { headers: new Headers({ Range: "bytes=0-1" }) };
  it.each([
    [
      "cross-origin audio",
      request("https://abc.public.blob.vercel-storage.com/audio/2026-10-07.mp3", {
        destination: "audio",
      }),
    ],
    ["same-origin audio by extension: mp3", request("/d/x.mp3")],
    ["same-origin audio by extension: wav", request("/_astro/audio.wav")],
    ["same-origin audio by extension: m4a", request("/covers/a.m4a")],
    ["same-origin audio by extension: upper-case OGG", request("/d/b.OGG")],
    ["audio by destination", request("/d/stream", { destination: "audio" })],
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
  it("never answers or stores /api/narrate, so a narration shows up the moment it exists", async () => {
    let audioExists = false;
    const worker = load(
      () => new Response(audioExists ? "audio" : "none", { status: audioExists ? 200 : 404 }),
    );
    const lookups = [
      request("/api/narrate?digest=2026-10-07"),
      // However the page asks: as a navigation, or accepting HTML, it is still the API.
      request("/api/narrate?digest=2026-10-07", { mode: "navigate" }),
      request("/api/narrate?digest=2026-10-07", {
        headers: new Headers({ Accept: "text/html" }),
      }),
      request("/api/narrate", { method: "POST" }),
    ];
    for (const lookup of lookups) {
      expect((await worker.dispatchFetch(lookup)).handled).toBe(false);
    }
    // The same question after the narration exists still goes to the network.
    audioExists = true;
    expect((await worker.dispatchFetch(lookups[0] ?? request("/"))).handled).toBe(false);
    // The worker neither fetched on the page's behalf nor kept anything.
    expect(worker.fetched).toEqual([]);
    expect(worker.caches.stored()).toEqual([]);
  });

  it("does not bring a cached page back for /api/narrate when the network is down", async () => {
    let online = true;
    const worker = load(() => {
      if (!online) throw new TypeError("offline");
      return new Response("page");
    });
    await worker.lifecycle("install");
    online = false;
    // A page request would fall back to /offline here. The API must not.
    const result = await worker.dispatchFetch(request("/api/narrate?digest=2026-10-07"));
    expect(result.handled).toBe(false);
    expect(result.response).toBeUndefined();
  });
});

describe("service worker: caching strategies", () => {
  it("serves hashed assets cache first", async () => {
    const worker = load();
    await worker.dispatchFetch(request("/_astro/app.abc.css"));
    const second = await worker.dispatchFetch(request("/_astro/app.abc.css"));
    expect(second.handled).toBe(true);
    expect(worker.fetched).toEqual([`${ORIGIN}/_astro/app.abc.css`]);
  });

  it("serves a digest page stale while it revalidates", async () => {
    let version = 1;
    const worker = load(() => new Response(`page v${version}`));
    const first = await worker.dispatchFetch(request("/d/2026-10-07"));
    expect(await first.response?.text()).toBe("page v1");
    version = 2;
    const second = await worker.dispatchFetch(request("/d/2026-10-07"));
    expect(await second.response?.text()).toBe("page v1");
    const third = await worker.dispatchFetch(request("/d/2026-10-07"));
    expect(await third.response?.text()).toBe("page v2");
  });

  it("goes to the network first for the home page", async () => {
    let version = 1;
    const worker = load(() => new Response(`home v${version}`));
    await worker.dispatchFetch(request("/", { mode: "navigate" }));
    version = 2;
    const next = await worker.dispatchFetch(request("/", { mode: "navigate" }));
    expect(await next.response?.text()).toBe("home v2");
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
    await worker.caches.open("dispatch-shell-v0");
    await worker.caches.open("dispatch-pages-v0");
    await worker.caches.open("someone-elses-cache");
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    const names = await worker.caches.keys();
    expect(names).not.toContain("dispatch-shell-v0");
    expect(names).not.toContain("dispatch-pages-v0");
    expect(names).toContain("someone-elses-cache");
    expect(names).toContain(`dispatch-shell-${CURRENT_VERSION}`);
    expect(worker.claim).toHaveBeenCalled();
  });
});
