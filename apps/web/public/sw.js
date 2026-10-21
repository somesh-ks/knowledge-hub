/*
 * Dispatch service worker. Hand-written and small on purpose: it keeps the reading experience
 * available offline and nothing else.
 *
 *   - Precaches the shell (the home page and /offline) with their stylesheet, fonts and scripts.
 *   - Digest pages: stale-while-revalidate. A digest never changes once published, so the cached copy
 *     is right and the refresh in the background only matters for a correction.
 *   - Home, the library and /latest.json change whenever a briefing lands, so a page load goes to the
 *     network first and falls back to the cache after a short wait. A stale "today" would be a wrong answer.
 *   - A move inside the app (the client router's fetch, or a prefetch) is answered at once from a copy
 *     saved in the last few minutes and checked against the network behind it. If the page changed, the
 *     page on screen is told. When /latest.json changes, every saved page counts as old again.
 *   - Audio is never cached by the worker itself. The one exception is a file the person chose to
 *     download (Library menu, scripts/libraryDownloads.ts), which the page saved in AUDIO_CACHE. That
 *     file is answered from the cache with correct Range handling (206 and Content-Range), which
 *     Safari needs, and the cache survives a version bump: a download is the person's, not the
 *     worker's. Any other audio request goes to the network as it would have.
 *   - Bump VERSION when this file's logic changes; activation removes caches from older versions.
 */
const VERSION = "v11";
const SHELL_CACHE = `dispatch-shell-${VERSION}`;
const PAGES_CACHE = `dispatch-pages-${VERSION}`;
const MEDIA_CACHE = `dispatch-media-${VERSION}`;
/** Episodes saved for offline listening. Not versioned: a new worker keeps what the person downloaded. */
const AUDIO_CACHE = "dispatch-audio-v1";
const CURRENT_CACHES = [SHELL_CACHE, PAGES_CACHE, MEDIA_CACHE, AUDIO_CACHE];

const OFFLINE_URL = "/offline";
const SHELL_PAGES = ["/", "/library", OFFLINE_URL];
const SHELL_FILES = ["/manifest.webmanifest", "/favicon.svg", "/icon-192.png"];
const NETWORK_WAIT_MS = 3000;
/** A saved page younger than this answers a move inside the app without waiting for the network. */
const FRESH_MS = 10 * 60 * 1000;
/** A saved page younger than this is not checked against the network again. */
const RECHECK_MS = 15 * 1000;
/** When a page was saved, in milliseconds, on the saved copy. */
const STORED_AT = "x-dispatch-stored-at";
const LATEST_PATH = "/latest.json";
const MAX_PAGES = 60;
const MAX_MEDIA = 80;
const AUDIO_PATH = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

/* ------------------------------------------------------------------ install */

/** Every /_astro/ file a document or stylesheet or script points at, for offline rendering. */
function referencedAssets(text, baseUrl) {
  const found = new Set();
  const patterns = [
    // The bundler writes a literal import with a backtick quote as often as with a plain one.
    /["'`(]\s*((?:\/|\.\/|\.\.\/)[^"'`)\s]*?\.(?:css|js|woff2|png|svg))/g,
    /\bfrom\s*["'`]([^"'`]+\.js)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/g,
    /\bimport\s*["'`]([^"'`]+\.js)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      try {
        const url = new URL(match[1], baseUrl);
        if (url.origin === self.location.origin && url.pathname.startsWith("/_astro/")) {
          found.add(url.pathname);
        }
      } catch {
        // Not a URL: skip it.
      }
    }
  }
  return found;
}

/** Follows stylesheet and script references a few levels deep and stores each file once. Returns every address it visited. */
async function precacheAssets(cache, startUrls, baseUrl, depth) {
  const queue = [...startUrls];
  const seen = new Set();
  for (let level = 0; level <= depth && queue.length > 0; level += 1) {
    const batch = queue.splice(0, queue.length).filter((url) => !seen.has(url));
    const next = await Promise.all(
      batch.map(async (url) => {
        seen.add(url);
        try {
          // A hashed file never changes, so one already saved is not fetched again.
          if (url.startsWith("/_astro/") && (await cache.match(url))) return [];
          const response = await fetch(url);
          if (!response.ok) return [];
          await cache.put(url, response.clone());
          if (/\.(css|js)$/.test(url)) {
            return [...referencedAssets(await response.text(), new URL(url, baseUrl))];
          }
        } catch {
          // A missing asset must not fail the install: the rest of the shell is still useful.
        }
        return [];
      }),
    );
    queue.push(...next.flat());
  }
  return seen;
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const assets = new Set();
  await Promise.all(
    SHELL_PAGES.map(async (path) => {
      try {
        const response = await fetch(path, { cache: "reload" });
        if (!response.ok) return;
        await cache.put(path, response.clone());
        for (const asset of referencedAssets(await response.text(), self.location.origin)) {
          assets.add(asset);
        }
      } catch {
        // The shell is best effort.
      }
    }),
  );
  // Deep enough for the longest chain of lazy imports: a file missed here fails offline.
  const current = await precacheAssets(cache, [...assets, ...SHELL_FILES], self.location.origin, 6);
  // Every deploy renames its hashed files, and the cache is only emptied when VERSION changes. Drop the
  // ones the shell no longer reaches, or the cache grows without bound. Only when the pages were read:
  // a failed fetch would otherwise look like a shell that needs nothing. A page visited since is warmed
  // again on its next visit.
  if (assets.size === 0) return;
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    if (path.startsWith("/_astro/") && !current.has(path)) await cache.delete(key);
  }
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: an update waits until the page says nothing is playing (SKIP_WAITING below).
  event.waitUntil(precacheShell());
});

/**
 * The addresses of downloaded files, in memory, so the fetch handler can tell at once whether a
 * request is one it should answer: an audio read the person never downloaded goes straight to the
 * network, as before downloads existed, with no cache lookup on the playback path. Filled when the
 * worker starts and again whenever the page says the downloads changed.
 */
const downloaded = new Set();

async function refreshDownloaded() {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const keys = await cache.keys();
    downloaded.clear();
    for (const key of keys) downloaded.add(key.url);
  } catch {
    // Storage blocked: nothing is downloaded, and every request goes to the network.
  }
}

refreshDownloaded();

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "DOWNLOADS_CHANGED") event.waitUntil(refreshDownloaded());
  // A download asks for the page's scripts and styles to be saved too, and hears when they are.
  if (data.type === "WARM_PAGE" && typeof data.path === "string" && data.path.startsWith("/")) {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      fetch(data.path)
        .then((response) => (response.ok ? warmAssets(response) : undefined))
        .catch(() => undefined)
        .then(() => port?.postMessage("done")),
    );
  }
});

/* ------------------------------------------------------------------ activate */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("dispatch-") && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      // The browser starts a page request while the worker boots; the strategies below use that answer.
      await self.registration?.navigationPreload?.enable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

/* ------------------------------------------------------------------ strategies */

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // keys() is in insertion order, so the oldest entries go first.
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)),
  );
}

/** Keeps the worker alive for work that outlasts the answer. Its failure never reaches the page. */
function background(event, work) {
  const quiet = work.catch(() => undefined);
  try {
    event.waitUntil(quiet);
  } catch {
    // The event has already ended; the work still runs while the worker lives.
  }
}

/** A copy of a response that records when it was saved. */
async function stamped(response, time) {
  const headers = new Headers(response.headers);
  headers.set(STORED_AT, String(time));
  return new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function store(cacheName, request, response, limit) {
  if (!response.ok || response.type === "opaque") return;
  // Cloned before any wait. A script answered from the network is already being read by the page when
  // the cache opens, and a body in use cannot be cloned: nothing fetched at run time was ever saved,
  // so a lazy chunk the page had not been warmed for was missing offline.
  const kept = response.clone();
  const cache = await caches.open(cacheName);
  // Pages carry the time they were saved, so a move inside the app can tell a recent copy from an old one.
  const copy = cacheName === PAGES_CACHE ? await stamped(kept, Date.now()) : kept;
  await cache.put(request, copy);
  if (limit) await trim(cacheName, limit);
}

/**
 * Marks every saved page as old without deleting it: it still answers when the network is down, but
 * no longer answers a move inside the app. Briefings are left alone, since one never changes.
 */
async function expirePages() {
  const cache = await caches.open(PAGES_CACHE);
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    if (path === LATEST_PATH || path.startsWith("/d/")) continue;
    const saved = await cache.match(key);
    if (saved) await cache.put(key, await stamped(saved, 0));
  }
}

/** /latest.json names the newest briefing: a different answer means the site was rebuilt. */
async function expirePagesIfChanged(request, response) {
  const cache = await caches.open(PAGES_CACHE);
  const saved = await cache.match(request);
  if (!saved) return;
  const [was, is] = await Promise.all([saved.text(), response.clone().text()]);
  if (was !== is) await expirePages();
}

/** Saves the scripts and styles a page names, so the first move to it does not wait for them. */
async function warmAssets(response) {
  if (!(response.headers.get("content-type") || "").includes("text/html")) return;
  const cache = await caches.open(SHELL_CACHE);
  const assets = referencedAssets(await response.text(), self.location.origin);
  // As deep as the install goes: an editor behind two lazy imports is on the page, and a file missed
  // here fails offline. Files already saved are skipped, so a page after the first costs little.
  await precacheAssets(cache, [...assets], self.location.origin, 6);
}

/**
 * The answer to a page load. The browser starts the request while the worker boots (navigation
 * preload) and an unused one is wasted, so it is the network answer when there is one.
 */
async function pageFetch(event) {
  const preloaded = event.preloadResponse
    ? await event.preloadResponse.catch(() => undefined)
    : undefined;
  return preloaded || fetch(event.request);
}

function staleWhileRevalidate(event, cacheName, limit) {
  const request = event.request;
  const refresh = pageFetch(event)
    .then(async (response) => {
      await store(cacheName, request, response, limit);
      return response;
    })
    .catch(() => undefined);
  event.waitUntil(refresh);
  return caches
    .match(request)
    .then((cached) => cached || refresh.then((fresh) => fresh || offline(request)));
}

/** Requests for pages that are on their way, by address. */
const inFlight = new Map();

/**
 * One network request for a page, shared by everyone asking for it at the same moment: a prefetch
 * started on finger-down and the client router's fetch a tenth of a second later.
 */
function sharedFetch(request) {
  let pending = inFlight.get(request.url);
  if (!pending) {
    pending = fetch(request.url);
    inFlight.set(request.url, pending);
    const done = () => inFlight.delete(request.url);
    pending.then(done, done);
  }
  return pending.then((response) => response.clone());
}

/**
 * `key` is the cache entry the answer is saved under, when it is not the request itself: /latest.json
 * is saved under its bare path whatever query string asked for it.
 */
function networkFirst(event, cacheName, limit, beforeStore, shared, key) {
  const request = event.request;
  const saveAs = key || request;
  const network = (shared ? sharedFetch(request) : pageFetch(event)).then(async (response) => {
    if (response.ok && beforeStore) await beforeStore(saveAs, response);
    await store(cacheName, saveAs, response, limit);
    if (response.ok) background(event, warmAssets(response.clone()));
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), NETWORK_WAIT_MS));
  event.waitUntil(network.catch(() => undefined));
  return Promise.race([network.catch(() => undefined), timeout]).then(async (response) => {
    if (response) return response;
    const cached = await caches.match(saveAs);
    // Slow network and nothing saved: keep waiting for the real answer, then fall back to /offline.
    return cached || network.catch(() => offline(request));
  });
}

/**
 * A move inside the app: the saved copy answers at once when it is recent, and the network is asked
 * behind it. An older copy, or none, waits for the network as a page load does.
 */
async function inAppPage(event) {
  const request = event.request;
  const cache = await caches.open(PAGES_CACHE);
  const saved = await cache.match(request, { ignoreVary: true });
  const age = saved ? Date.now() - Number(saved.headers.get(STORED_AT) || 0) : Infinity;
  if (!saved || age > FRESH_MS) return networkFirst(event, PAGES_CACHE, MAX_PAGES, undefined, true);
  if (age > RECHECK_MS) background(event, recheck(request, saved.clone()));
  return saved;
}

/** Fetches a page that was answered from its saved copy, and tells open pages when it has changed. */
async function recheck(request, saved) {
  try {
    const fresh = await fetch(request.url);
    if (!fresh.ok) return;
    const [was, is] = await Promise.all([saved.text(), fresh.clone().text()]);
    await store(PAGES_CACHE, request, fresh, MAX_PAGES);
    if (was === is) return;
    await warmAssets(fresh.clone());
    const path = new URL(request.url).pathname;
    for (const client of await self.clients.matchAll({ type: "window" })) {
      client.postMessage({ type: "PAGE_CHANGED", path });
    }
  } catch {
    // Offline or a failed read: the saved copy already answered.
  }
}

async function cacheFirst(event, cacheName) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  event.waitUntil(store(cacheName, event.request, response));
  return response;
}

async function offline(request) {
  if (isPage(request)) {
    const page = await caches.match(OFFLINE_URL);
    if (page) return page;
  }
  return Response.error();
}

/** A page, as opposed to an asset: a navigation, an HTML request, or a path with no file extension. */
function isPage(request) {
  const url = new URL(request.url);
  return (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html") ||
    !/\.[a-z0-9]+$/i.test(url.pathname)
  );
}

/* ------------------------------------------------------------------ downloaded audio */

/**
 * The bytes a Range header asks for, as [start, end] inclusive, or null when it cannot be met.
 * Handles "bytes=a-b", "bytes=a-" and the suffix form "bytes=-n". Only the first range is served.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || "").split(",")[0].trim());
  if (!match || (match[1] === "" && match[2] === "") || size <= 0) return null;
  let start;
  let end;
  if (match[1] === "") {
    const length = Number(match[2]);
    if (length === 0) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? null : [start, end];
}

/** A saved file as the answer to a request, whole or the slice a Range header names. */
async function fromDownload(cached, rangeHeader) {
  const blob = await cached.blob();
  const type = cached.headers.get("content-type") || "audio/mpeg";
  const base = { "content-type": type, "accept-ranges": "bytes" };
  if (!rangeHeader) {
    return new Response(blob, {
      status: 200,
      headers: { ...base, "content-length": String(blob.size) },
    });
  }
  const range = parseRange(rangeHeader, blob.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { ...base, "content-range": `bytes */${blob.size}` },
    });
  }
  const [start, end] = range;
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      ...base,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${blob.size}`,
    },
  });
}

/** A request for audio the person downloaded, or undefined to let it go to the network. */
async function downloadedAudio(request) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const cached = await cache.match(request.url);
    return cached ? await fromDownload(cached, request.headers.get("range")) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The narrate lookup and word marks of a downloaded episode, when the network will not answer:
 * the download saved them under the same address. Online they go to the network as before.
 */
async function downloadedApi(request) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const cached = await cache.match(request.url);
    if (cached) return cached;
  } catch {
    // Fall through to the error below.
  }
  return Response.error();
}

/* ------------------------------------------------------------------ routing */

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // A downloaded file is answered here, from any origin, with or without a Range header. Offline
  // the worker also looks (its list may not be read yet after a restart); online, audio that was
  // never downloaded is left alone.
  if (
    (request.destination === "audio" || AUDIO_PATH.test(url.pathname)) &&
    (downloaded.has(request.url) || self.navigator?.onLine === false)
  ) {
    event.respondWith(downloadedAudio(request).then((answer) => answer || fetch(request)));
    return;
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname === "/api/narrate" || url.pathname === "/api/narrate-marks")
  ) {
    event.respondWith(fetch(request).catch(() => downloadedApi(request)));
    return;
  }

  // Never serve or store: other origins (the audio host included), ranged reads, audio, the API.
  if (url.origin !== self.location.origin) return;
  if (request.headers.has("range")) return;
  if (request.destination === "audio" || request.destination === "video") return;
  if (AUDIO_PATH.test(url.pathname) || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_astro/")) {
    event.respondWith(cacheFirst(event, SHELL_CACHE));
  } else if (url.pathname.startsWith("/d/")) {
    event.respondWith(staleWhileRevalidate(event, PAGES_CACHE, MAX_PAGES));
  } else if (url.pathname === LATEST_PATH) {
    // One entry under the bare path, whatever the query: a copy per query string would never match
    // the one before it (so the check for a new briefing never fired) and would push real pages out.
    event.respondWith(
      networkFirst(event, PAGES_CACHE, MAX_PAGES, expirePagesIfChanged, false, LATEST_PATH),
    );
  } else if (isPage(request)) {
    // A page load waits for the network. The client router's fetch and a prefetch do not have to.
    event.respondWith(
      request.mode === "navigate" ? networkFirst(event, PAGES_CACHE, MAX_PAGES) : inAppPage(event),
    );
  } else if (url.pathname.startsWith("/covers/")) {
    event.respondWith(staleWhileRevalidate(event, MEDIA_CACHE, MAX_MEDIA));
  } else if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
  }
});
