/*
 * Dispatch service worker. Hand-written and small on purpose: it keeps the reading experience
 * available offline and nothing else.
 *
 *   - Precaches the shell (the home page and /offline) with their stylesheet, fonts and scripts.
 *   - Digest pages: stale-while-revalidate. A digest never changes once published, so the cached copy
 *     is right and the refresh in the background only matters for a correction.
 *   - Home, archive and /latest.json change whenever a briefing lands, so they go to the network first
 *     and fall back to the cache after a short wait. A stale "today" would be a wrong answer.
 *   - NEVER touches audio. Serving media from the Cache API without correct Range handling breaks
 *     Safari playback, so audio, ranged requests and cross-origin requests all pass straight through.
 *   - Bump VERSION when this file's logic changes; activation removes caches from older versions.
 */
const VERSION = "v1";
const SHELL_CACHE = `dispatch-shell-${VERSION}`;
const PAGES_CACHE = `dispatch-pages-${VERSION}`;
const MEDIA_CACHE = `dispatch-media-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, PAGES_CACHE, MEDIA_CACHE];

const OFFLINE_URL = "/offline";
const SHELL_PAGES = ["/", OFFLINE_URL];
const SHELL_FILES = ["/manifest.webmanifest", "/favicon.svg", "/icon-192.png"];
const NETWORK_WAIT_MS = 3000;
const MAX_PAGES = 60;
const MAX_MEDIA = 80;
const AUDIO_PATH = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;

/* ------------------------------------------------------------------ install */

/** Every /_astro/ file a document or stylesheet or script points at, for offline rendering. */
function referencedAssets(text, baseUrl) {
  const found = new Set();
  const patterns = [
    /["'(]\s*((?:\/|\.\/|\.\.\/)[^"')\s]*?\.(?:css|js|woff2|png|svg))/g,
    /\bfrom\s*["']([^"']+\.js)["']/g,
    /\bimport\s*\(\s*["']([^"']+\.js)["']\s*\)/g,
    /\bimport\s*["']([^"']+\.js)["']/g,
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

/** Follows stylesheet and script references a few levels deep and stores each file once. */
async function precacheAssets(cache, startUrls, baseUrl, depth) {
  const queue = [...startUrls];
  const seen = new Set();
  for (let level = 0; level <= depth && queue.length > 0; level += 1) {
    const batch = queue.splice(0, queue.length).filter((url) => !seen.has(url));
    const next = await Promise.all(
      batch.map(async (url) => {
        seen.add(url);
        try {
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
  await precacheAssets(cache, [...assets, ...SHELL_FILES], self.location.origin, 3);
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: an update waits until the page says nothing is playing (SKIP_WAITING below).
  event.waitUntil(precacheShell());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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

async function store(cacheName, request, response, limit) {
  if (!response.ok || response.type === "opaque") return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (limit) await trim(cacheName, limit);
}

function staleWhileRevalidate(event, cacheName, limit) {
  const request = event.request;
  const refresh = fetch(request)
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

function networkFirst(event, cacheName, limit) {
  const request = event.request;
  const network = fetch(request).then(async (response) => {
    await store(cacheName, request, response, limit);
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), NETWORK_WAIT_MS));
  event.waitUntil(network.catch(() => undefined));
  return Promise.race([network.catch(() => undefined), timeout]).then(async (response) => {
    if (response) return response;
    const cached = await caches.match(request);
    // Slow network and nothing saved: keep waiting for the real answer, then fall back to /offline.
    return cached || network.catch(() => offline(request));
  });
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
    !/.[a-z0-9]+$/i.test(url.pathname)
  );
}

/* ------------------------------------------------------------------ routing */

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never serve or store: other origins (the audio host included), ranged reads, audio, the API.
  if (url.origin !== self.location.origin) return;
  if (request.headers.has("range")) return;
  if (request.destination === "audio" || request.destination === "video") return;
  if (AUDIO_PATH.test(url.pathname) || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_astro/")) {
    event.respondWith(cacheFirst(event, SHELL_CACHE));
  } else if (url.pathname.startsWith("/d/")) {
    event.respondWith(staleWhileRevalidate(event, PAGES_CACHE, MAX_PAGES));
  } else if (isPage(request) || url.pathname === "/latest.json") {
    event.respondWith(networkFirst(event, PAGES_CACHE, MAX_PAGES));
  } else if (url.pathname.startsWith("/covers/")) {
    event.respondWith(staleWhileRevalidate(event, MEDIA_CACHE, MAX_MEDIA));
  } else if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
  }
});
