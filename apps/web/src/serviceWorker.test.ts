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
    clients: { claim },
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

  return { handlers, caches, skipWaiting, claim, fetched, dispatchFetch, lifecycle };
}

describe("service worker: audio is never cached or touched", () => {
  it("passes a cross-origin audio request straight through", async () => {
    const worker = load();
    const result = await worker.dispatchFetch(
      request("https://abc.public.blob.vercel-storage.com/audio/2026-10-07.mp3", {
        destination: "audio",
      }),
    );
    expect(result.handled).toBe(false);
    expect(worker.caches.stored()).toEqual([]);
  });

  it("does not handle a same-origin audio file by extension", async () => {
    const worker = load();
    for (const path of ["/audio/x.mp3", "/fixtures/audio.wav", "/a.m4a", "/b.OGG"]) {
      expect((await worker.dispatchFetch(request(path))).handled).toBe(false);
    }
    expect(worker.fetched).toEqual([]);
  });

  it("does not handle audio or video by destination", async () => {
    const worker = load();
    expect((await worker.dispatchFetch(request("/stream", { destination: "audio" }))).handled).toBe(
      false,
    );
    expect((await worker.dispatchFetch(request("/clip", { destination: "video" }))).handled).toBe(
      false,
    );
  });

  it("does not handle a Range request, so Safari seeking works", async () => {
    const worker = load();
    const ranged = request("/d/2026-10-07", { headers: new Headers({ Range: "bytes=0-1" }) });
    expect((await worker.dispatchFetch(ranged)).handled).toBe(false);
  });
});

describe("service worker: what it leaves alone", () => {
  it("ignores non-GET requests and the API", async () => {
    const worker = load();
    expect((await worker.dispatchFetch(request("/api/generate", { method: "POST" }))).handled).toBe(
      false,
    );
    expect((await worker.dispatchFetch(request("/api/status?run=1"))).handled).toBe(false);
    expect((await worker.dispatchFetch(request("/api/generate"))).handled).toBe(false);
  });

  it("ignores other origins", async () => {
    const worker = load();
    expect((await worker.dispatchFetch(request("https://example.com/x.css"))).handled).toBe(false);
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
    expect(names).toContain("dispatch-shell-v1");
    expect(worker.claim).toHaveBeenCalled();
  });

  it("uses a versioned cache name", () => {
    expect(SOURCE).toMatch(/const VERSION = "v\d+"/);
  });
});
