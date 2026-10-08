/**
 * Episodes this device has deleted. A delete is a commit and a redeploy, so for a few minutes the
 * built site still lists the episode; this list hides it meanwhile. Entries are dropped once the
 * Library no longer has the card, after an hour, or, if the card is still there after ten minutes,
 * because the delete evidently failed.
 */
export const DELETED_KEY = "dispatch:deleted-episodes";
export const DELETED_MAX_AGE_MS = 60 * 60 * 1000;
export const DELETED_FAILED_AFTER_MS = 10 * 60 * 1000;

export interface DeletedEpisode {
  id: string;
  at: number;
}

/** The stored list; anything that is not a list of `{ id, at }` reads as empty. */
export function parseDeleted(raw: string | null): DeletedEpisode[] {
  try {
    const list: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(
      (entry): entry is DeletedEpisode =>
        typeof entry?.id === "string" && typeof entry?.at === "number",
    );
  } catch {
    return [];
  }
}

export function addDeleted(list: DeletedEpisode[], id: string, now: number): DeletedEpisode[] {
  return [...list.filter((entry) => entry.id !== id), { id, at: now }];
}

/**
 * What stays on the list. `present` is the set of episode ids the Library card list holds, or null
 * where that list is not at hand (only age applies then).
 */
export function pruneDeleted(
  list: DeletedEpisode[],
  present: ReadonlySet<string> | null,
  now: number,
): DeletedEpisode[] {
  return list.filter(({ id, at }) => {
    const age = now - at;
    if (age > DELETED_MAX_AGE_MS || age < 0) return false;
    if (!present) return true;
    return present.has(id) && age <= DELETED_FAILED_AFTER_MS;
  });
}
