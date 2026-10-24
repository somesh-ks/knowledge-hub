/**
 * What the config store holds (D149), for a settings page built before it: GET /api/config answers
 * with the edits that turn the page's built copy into the stored config, and the sources a topic
 * page must draw. savedView.ts lays them over the page as it lays a just-saved edit, before the
 * editor reads its starting point, so an edit made on any device shows here, and a toggle sends
 * from what is stored, not from the build.
 *
 * Loaded only when the build says the store is on (storeOn, lib/savedKey.ts). The device keeps the
 * last answer it read (D172): a store that is slow (Neon waking), down or unreachable (offline)
 * answers from that copy after a short grace, so the page shows what this device last knew rather
 * than the build, which is a run old by design. A store that answers in time, or answers later, is
 * what the next read and the copy hold. With no copy, an outage costs freshness, never the page.
 */
import type { ConfigOp, ConfigReadBody, StoreSource } from "../types/contracts";

/** How long a page waits for the store before it keeps its built copy. */
export const STORE_READ_TIMEOUT_MS = 2500;

/** One read serves the scripts of one page view; a page opened a second later asks again. */
const REUSE_MS = 1000;
/** How long a page waits for the store before it shows the device's copy instead, when it has one. */
export const CACHE_GRACE_MS = 300;
/** Where the device keeps the last answer: one build's edits, checked against the page on read. */
export const CACHE_KEY = "dispatch:store-read";

let last: { at: number; read: Promise<ConfigReadBody | null> } | undefined;
let current: ConfigReadBody | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Which config files this page was built from, as its config-store tag names them. */
function builtHere(): string | null {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="dispatch-config-store"]')?.content ?? null
  );
}

function parseRead(body: unknown): ConfigReadBody | null {
  if (!isRecord(body) || body.status !== 200) return null;
  const { written_at: writtenAt, ops, sources, built } = body;
  if (!Array.isArray(ops) || !Array.isArray(sources)) return null;
  if (writtenAt !== null && typeof writtenAt !== "number") return null;
  // The edits are a diff from the files the answering deployment was built from. A page from
  // another build (a kept copy, a tab open across a deploy) keeps its own copy instead; the deploy
  // toast offers the current site.
  if (typeof built !== "string" || built !== builtHere()) return null;
  return {
    status: 200,
    built,
    written_at: writtenAt,
    ops: ops.filter((op): op is ConfigOp => isRecord(op) && typeof op.op === "string"),
    sources: sources.filter(
      (source): source is StoreSource =>
        isRecord(source) &&
        typeof source.id === "string" &&
        typeof source.page === "string" &&
        typeof source.name === "string",
    ),
  };
}

/** The device's copy of the last answer, when it is for this build; null otherwise. */
function readCache(): ConfigReadBody | null {
  try {
    return parseRead(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

function writeCache(body: ConfigReadBody): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(body));
  } catch {
    // A full or blocked storage only costs the next load its copy.
  }
}

/**
 * Asks the store, once per page view: the store's answer when it comes within the grace, else the
 * device's copy at once while the store is still asked; null when it is off, down, slow or
 * unreadable and the device has no copy.
 */
export function loadStore(now = Date.now()): Promise<ConfigReadBody | null> {
  // A read reused within the second answers as storeRead does: for the page now in the document.
  if (last && now - last.at < REUSE_MS) return last.read.then(() => storeRead());
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), STORE_READ_TIMEOUT_MS);
  const asked = { at: now } as { at: number; read: Promise<ConfigReadBody | null> };
  const cached = readCache();
  asked.read = fetch("/api/config", {
    signal: stop.signal,
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseRead)
    .catch(() => null)
    .then((body) => {
      clearTimeout(timer);
      // Only the newest read speaks for the store: an older one that ends late, or fails, does not
      // replace what a newer one found. A failed read leaves the device's copy standing.
      if (last === asked && body) current = body;
      if (body) writeCache(body);
      return body ?? (last === asked ? current : null);
    });
  last = asked;
  if (!cached) return asked.read;
  // The copy stands until the store answers; a read that ends after the grace updates `current`
  // for whatever reads next, and the copy for the next page.
  if (current === null) current = cached;
  let settled = false;
  const fromStore = asked.read.then((body) => {
    settled = true;
    return body ?? cached;
  });
  const fromCache = new Promise<ConfigReadBody>((resolve) => {
    setTimeout(() => resolve(cached), CACHE_GRACE_MS);
  });
  return Promise.race([fromStore, fromCache]).then((body) => (settled ? body : cached));
}

/** What the last read found, or null before one answered (or when none could). */
export function storeRead(): ConfigReadBody | null {
  // Checked again for the page now in the document: the read may have been made for another one.
  return current !== null && current.built === builtHere() ? current : null;
}
