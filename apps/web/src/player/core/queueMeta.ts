import type { PlayerDigestData } from "../../types/contracts";
import { readDigestData } from "./digestData";
import { longDateFromDigestId } from "./formatTime";
import { recordingCaption } from "./playerCopy";
import { queueItemUrl } from "./playQueue";

export interface QueueMeta {
  title: string;
  /** "Daily · 6 min", as the player says it under a recording with no stories. */
  caption: string;
  cover: PlayerDigestData["cover"];
  weekly: boolean;
}

function metaOf(data: PlayerDigestData): QueueMeta {
  return {
    title: data.title || longDateFromDigestId(data.id),
    caption: recordingCaption(data),
    cover: data.cover,
    weekly: data.kind === "weekly",
  };
}

const known = new Map<string, QueueMeta | null>();
const digests = new Map<string, PlayerDigestData>();
const asked = new Map<string, Promise<QueueMeta | null>>();

/**
 * A queued item's full data once its page has been read: what the player plays it from, so an item
 * is started in place, with no page move.
 */
export function queueDigestFor(id: string): PlayerDigestData | null {
  return digests.get(id) ?? null;
}

/** Reads the item's page if it has not been read yet; null where it cannot be. */
export async function loadQueueDigest(id: string): Promise<PlayerDigestData | null> {
  await loadQueueMeta(id);
  return queueDigestFor(id);
}

/** What a queued item's row shows, once its page has said. Null until then, or if it never does. */
export function queueMetaFor(id: string): QueueMeta | null {
  return known.get(id) ?? null;
}

/**
 * Reads a queued item's title and cover from its own page, the same data the player plays it from.
 * Each page is asked once; the browser (and the service worker) usually holds it already.
 */
export function loadQueueMeta(id: string): Promise<QueueMeta | null> {
  const cached = asked.get(id);
  if (cached) return cached;
  const request = fetch(queueItemUrl(id), { credentials: "same-origin" })
    .then((response) => (response.ok ? response.text() : ""))
    .then((html) => {
      const data = html ? readDigestData(new DOMParser().parseFromString(html, "text/html")) : null;
      const meta = data ? metaOf(data) : null;
      known.set(id, meta);
      if (data) digests.set(id, data);
      return meta;
    })
    .catch(() => {
      // Offline or gone: ask again next time the row is drawn.
      asked.delete(id);
      return null;
    });
  asked.set(id, request);
  return request;
}
