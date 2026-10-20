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
const asked = new Map<string, Promise<QueueMeta | null>>();

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

/** Remembers what the player already knows about an item, so its row needs no fetch. */
export function rememberQueueMeta(data: PlayerDigestData): void {
  known.set(data.id, metaOf(data));
  asked.set(data.id, Promise.resolve(known.get(data.id) ?? null));
}
