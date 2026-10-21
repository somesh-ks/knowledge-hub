/**
 * Download for offline listening, from the Library menu. The audio file, the item's page (which
 * carries its data) and its covers go into one Cache Storage cache; public/sw.js answers requests
 * for them from it, Range included. At most MAX_DOWNLOADS are kept, the oldest going first
 * (lib/downloads.ts). Loaded on the first pick of Download, and at idle to mark the rows.
 */
import {
  AUDIO_CACHE,
  addDownload,
  addressesOf,
  confirmLookup,
  coverAddresses,
  type Download,
  lookupAddress,
  MANIFEST_KEY,
  marksAddress,
  NotReadyError,
  parseDownloads,
  segmentUrls,
} from "../lib/downloads";

/** How long the worker gets to save the page's scripts before the download counts as done. */
const WARM_MS = 15_000;

export async function readDownloads(): Promise<Download[]> {
  try {
    if (!("caches" in globalThis) || !(await caches.has(AUDIO_CACHE))) return [];
    const cache = await caches.open(AUDIO_CACHE);
    const saved = await cache.match(MANIFEST_KEY);
    return saved ? parseDownloads(await saved.text()) : [];
  } catch {
    return [];
  }
}

async function writeDownloads(cache: Cache, list: Download[]): Promise<void> {
  await cache.put(
    MANIFEST_KEY,
    new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }),
  );
  // The worker keeps the downloaded addresses in memory, to step in only for them (sw.js).
  navigator.serviceWorker?.controller?.postMessage({ type: "DOWNLOADS_CHANGED" });
}

/** Asks the worker to save the scripts the page needs offline, and waits for its answer. */
async function warmPage(path: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const worker = registration?.active;
    if (!worker) return;
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(resolve, WARM_MS);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };
      worker.postMessage({ type: "WARM_PAGE", path }, [channel.port2]);
    });
  } catch {
    // The page still opens offline if the worker already has its scripts.
  }
}

export interface DownloadRequest {
  id: string;
  audio: string;
  page: string;
  /** An episode's audio is one file per turn, found through the lookup the player uses. */
  kind?: "briefing" | "episode";
}

/**
 * Saves an episode: its lookup (every turn marked as stored), each turn's file and word marks, its
 * page and covers. A turn whose file is not stored is NotReadyError; nothing is narrated for it.
 */
/** `map` over `items` with at most `limit` calls in flight, results in the items' order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function downloadEpisode(cache: Cache, request: DownloadRequest): Promise<void> {
  const address = lookupAddress(request.id);
  const lookup = await fetch(address, { headers: { accept: "application/json" } });
  if (!lookup.ok) throw new Error(`lookup ${lookup.status}`);
  const body = (await lookup.json()) as Record<string, unknown>;
  const turns = segmentUrls(body);
  if (!turns) throw new NotReadyError();
  const page = await fetch(request.page);
  if (!page.ok) throw new Error(`page ${page.status}`);

  // Four at a time: a 40-turn episode was 80 round trips one after another.
  const files = await mapLimit(turns, 4, async (turn) => {
    const file = await fetch(turn.url);
    if (file.status === 404) throw new NotReadyError();
    if (!file.ok) throw new Error(`audio ${file.status}`);
    return file;
  });
  // Marks are optional (a turn narrated before they were kept has none): the page estimates.
  const marks = await mapLimit(turns, 4, (turn) =>
    fetch(marksAddress(request.id, turn.key)).catch(() => null),
  );

  const saved: string[] = [];
  const keep = async (key: string, response: Response): Promise<void> => {
    await cache.put(key, response);
    saved.push(key);
  };
  try {
    for (const [index, turn] of turns.entries()) {
      const file = files[index] as Response;
      await keep(
        turn.url,
        new Response(await file.blob(), {
          headers: { "content-type": file.headers.get("content-type") || "audio/mpeg" },
        }),
      );
      const mark = marks[index];
      if (mark?.ok) await keep(marksAddress(request.id, turn.key), mark);
    }
    for (const extra of coverAddresses(request.id)) {
      const cover = await fetch(extra).catch(() => null);
      if (cover?.ok) await keep(extra, cover);
    }
    await keep(request.page, page);
    await keep(
      address,
      new Response(JSON.stringify(confirmLookup(body)), {
        headers: { "content-type": "application/json" },
      }),
    );
    // The entry's `audio` is the lookup and its extras every other address, so remove drops them all.
    const { list, evicted } = addDownload(await readDownloads(), {
      id: request.id,
      audio: address,
      page: request.page,
      extras: saved.filter((key) => key !== request.page && key !== address),
    });
    for (const old of evicted) {
      for (const key of addressesOf(old)) await cache.delete(key);
    }
    await writeDownloads(cache, list);
  } catch (error) {
    for (const key of saved) await cache.delete(key).catch(() => false);
    throw error;
  }
}

/** Saves one item. Throws when the file cannot be fetched or stored; nothing is kept then. */
export async function download(request: DownloadRequest): Promise<void> {
  const cache = await caches.open(AUDIO_CACHE);
  if (request.kind === "episode") {
    await downloadEpisode(cache, request);
    await warmPage(request.page);
    return;
  }
  const audio = await fetch(request.audio);
  if (!audio.ok) throw new Error(`audio ${audio.status}`);
  const page = await fetch(request.page);
  if (!page.ok) throw new Error(`page ${page.status}`);
  const extras = coverAddresses(request.id);
  const saved: string[] = [request.audio, request.page];
  try {
    await cache.put(
      request.audio,
      new Response(await audio.blob(), {
        headers: { "content-type": audio.headers.get("content-type") || "audio/mpeg" },
      }),
    );
    await cache.put(request.page, page);
    for (const extra of extras) {
      const cover = await fetch(extra).catch(() => null);
      if (cover?.ok) {
        await cache.put(extra, cover);
        saved.push(extra);
      }
    }
    const { list, evicted } = addDownload(await readDownloads(), {
      ...request,
      extras: saved.slice(2),
    });
    for (const old of evicted) {
      for (const address of addressesOf(old)) await cache.delete(address);
    }
    await writeDownloads(cache, list);
  } catch (error) {
    // A full disk: leave no half-saved item behind.
    for (const address of saved) await cache.delete(address).catch(() => false);
    throw error;
  }
  await warmPage(request.page);
}

export async function removeDownload(id: string): Promise<void> {
  const cache = await caches.open(AUDIO_CACHE);
  const list = await readDownloads();
  for (const old of list.filter((item) => item.id === id)) {
    for (const address of addressesOf(old)) await cache.delete(address);
  }
  await writeDownloads(
    cache,
    list.filter((item) => item.id !== id),
  );
}
