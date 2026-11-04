/**
 * The last answer of each command-center read, kept on this device: a page paints it at once and
 * asks again behind it, so a cold database or a slow GitHub list no longer holds the page blank
 * (2026-11-04, the owner: "a huge delay in data loading"). Sign out forgets them all. Storage that
 * is blocked or full keeps nothing, and the page waits for its answer as before.
 */

const PREFIX = "singularity-admin:kept:";

interface Kept<T> {
  /** When the answer arrived, in ms. */
  at: number;
  body: T;
}

export function keptAnswer<T>(key: string): Kept<T> | null {
  try {
    const text = localStorage.getItem(PREFIX + key);
    if (!text) return null;
    const kept = JSON.parse(text) as Partial<Kept<T>>;
    return typeof kept.at === "number" && kept.body !== undefined
      ? { at: kept.at, body: kept.body as T }
      : null;
  } catch {
    return null;
  }
}

export function keepAnswer(key: string, body: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), body }));
  } catch {
    // Blocked or full: the next visit waits for its answer.
  }
}

/** Every kept answer, gone: the device forgets the owner's numbers when the owner signs out. */
export function forgetAnswers(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Blocked: nothing was kept.
  }
}

/** An answer's words without the time it was made, which differs every time. */
const unchanged = (body: unknown): string =>
  JSON.stringify(body, (key, value) => (key === "checked_at" ? undefined : value));

/**
 * Paints the kept answer for `key` (if any) with `stale: true`, then asks `url` and paints the fresh
 * one. Resolves with whether a fresh answer came; on a refusal or a failure the kept one stays up.
 */
export async function askKept<T>(
  url: string,
  key: string,
  paint: (body: T, stale: boolean) => void,
  init: RequestInit = {},
  /** "always" draws a fresh answer that says the same, for a page that shows when it was checked. */
  repaint: "changed" | "always" = "changed",
): Promise<{ fresh: boolean; status: number; shown: boolean }> {
  const kept = keptAnswer<T>(key);
  if (kept) paint(kept.body, true);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { accept: "application/json", ...init.headers },
    });
    if (!response.ok) return { fresh: false, status: response.status, shown: kept !== null };
    const body = (await response.json()) as T;
    keepAnswer(key, body);
    // An answer that says what the kept one said is not drawn again: an arc's sweep plays once.
    if (!kept || repaint === "always" || unchanged(kept.body) !== unchanged(body)) {
      paint(body, false);
    }
    return { fresh: true, status: response.status, shown: true };
  } catch {
    return { fresh: false, status: 0, shown: kept !== null };
  }
}
