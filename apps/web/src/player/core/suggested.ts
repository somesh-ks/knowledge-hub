import { DELETED_KEY, parseDeleted } from "../../lib/deletedEpisodes";
import { isQueueId } from "./playQueue";
import { readRemembered, type StorageLike } from "./resume";

/** How many suggestions Up next lists. Autoplay takes the first. */
export const SUGGESTED_COUNT = 5;

/**
 * What plays after `currentId`: the next OLDER item in timeline order (`ordered` is newest first)
 * that `skip` does not refuse. An item that is not in the list is one just made, which the site
 * does not hold yet: the newest item that is not skipped comes first then.
 */
export function suggestNext(
  ordered: readonly string[],
  currentId: string | null,
  skip: (id: string) => boolean,
  limit = SUGGESTED_COUNT,
): string[] {
  const at = currentId ? ordered.indexOf(currentId) : -1;
  return ordered
    .slice(at + 1)
    .filter((id) => id !== currentId && !skip(id))
    .slice(0, limit);
}

/** An item the listener deleted on this device, queued already, or has played to the end. */
export function skipper(
  storage: StorageLike | null,
  queued: readonly string[],
): (id: string) => boolean {
  let deleted = new Set<string>();
  try {
    deleted = new Set(parseDeleted(storage?.getItem(DELETED_KEY) ?? null).map((entry) => entry.id));
  } catch {
    // Blocked storage: nothing is known to be deleted.
  }
  return (id) => {
    if (deleted.has(id) || queued.includes(id)) return true;
    // A position of its own means it is being heard again: not played, as the cards say.
    const remembered = readRemembered(storage, id);
    return remembered.played && remembered.seconds <= 0;
  };
}

let known: string[] | null = null;
let issued = 0;
let accepted = 0;

/** The site's items, newest first (/timeline.json). Offline, the last answer; none yet, null. */
export async function loadTimeline(): Promise<readonly string[] | null> {
  const request = ++issued;
  try {
    const response = await fetch("/timeline.json", { credentials: "same-origin" });
    if (!response.ok) return known;
    const body: unknown = await response.json();
    const ids = (body as { ids?: unknown } | null)?.ids;
    // A slower, older answer never replaces a newer one: removed episodes stay removed.
    if (Array.isArray(ids) && request > accepted) {
      accepted = request;
      known = ids.filter(isQueueId);
    }
  } catch {
    // Offline: what was last read still orders the list.
  }
  return known;
}
