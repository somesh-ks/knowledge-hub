import { audioCandidates, browserCanPlayType } from "./audioSource";
import type { PlayQueue } from "./playQueue";
import { loadQueueDigest } from "./queueMeta";

/**
 * Keeps the first part of what is queued next in the browser's cache, so a tap on a queued item (the
 * next one or the third) starts at once instead of waiting on the network (D277).
 *
 * Only finished audio is fetched. An item with none yet is narrated when it is played, and narrating
 * costs money, so it is never started on queueing. Nothing is fetched on a metered or slow link, or
 * with Data Saver on, or offline. These are plain reads of files the player would fetch anyway; they
 * are not Blob "advanced operations" (list, put, copy), which are what the store's quota counts.
 */

/** Items ahead that get their start fetched. */
export const PREFETCH_AHEAD = 3;
/** How much of an item's file is fetched: about a minute of speech, enough to start playing. */
export const HEAD_BYTES = 512 * 1024;

interface Connection {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
}

/** True where fetching ahead is fine: online, not saving data, not a metered or slow link. */
export function mayPrefetch(connection: Connection | undefined, online: boolean): boolean {
  if (!online) return false;
  if (!connection) return true;
  if (connection.saveData) return false;
  if (connection.type === "cellular") return false;
  return connection.effectiveType === undefined || connection.effectiveType === "4g";
}

export function startQueuePrefetch(queue: PlayQueue, fetcher: typeof fetch = fetch): () => void {
  const warmed = new Set<string>();
  let stopped = false;

  async function warm(id: string): Promise<void> {
    const digest = await loadQueueDigest(id);
    if (stopped || !digest?.audio) return;
    const url = audioCandidates(digest.audio, browserCanPlayType())[0] ?? digest.audio.url;
    if (warmed.has(url)) return;
    warmed.add(url);
    try {
      const response = await fetcher(url, {
        headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
        mode: "cors",
        credentials: "omit",
      });
      // Read to the end so the cache keeps the part; a refusal is simply tried again on a later change.
      if (!response.ok) warmed.delete(url);
      else await response.arrayBuffer();
    } catch {
      warmed.delete(url);
    }
  }

  function run(): void {
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    if (!mayPrefetch(connection, navigator.onLine)) return;
    for (const id of queue.getIds().slice(0, PREFETCH_AHEAD)) void warm(id);
  }

  run();
  const off = queue.subscribe(run);
  return () => {
    stopped = true;
    off();
  };
}
