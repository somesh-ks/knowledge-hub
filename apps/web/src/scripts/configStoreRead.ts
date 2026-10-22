/**
 * What the config store holds (D149), for a settings page built before it: GET /api/config answers
 * with the edits that turn the page's built copy into the stored config, and the sources a topic
 * page must draw. savedView.ts lays them over the page as it lays a just-saved edit, before the
 * editor reads its starting point, so an edit made on any device shows here, and a toggle sends
 * from what is stored, not from the build.
 *
 * Loaded only when the build says the store is on (storeOn, lib/savedKey.ts). A store that does not
 * answer in time, answers an error, or answers something this cannot read leaves the built page as
 * it is: an outage costs freshness, never the page.
 */
import type { ConfigOp, ConfigReadBody, StoreSource } from "../types/contracts";

/** How long a page waits for the store before it keeps its built copy. */
export const STORE_READ_TIMEOUT_MS = 2500;

/** One read serves the scripts of one page view; a page opened a second later asks again. */
const REUSE_MS = 1000;

let last: { at: number; read: Promise<ConfigReadBody | null> } | undefined;
let current: ConfigReadBody | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseRead(body: unknown): ConfigReadBody | null {
  if (!isRecord(body) || body.status !== 200) return null;
  const { written_at: writtenAt, ops, sources } = body;
  if (!Array.isArray(ops) || !Array.isArray(sources)) return null;
  if (writtenAt !== null && typeof writtenAt !== "number") return null;
  return {
    status: 200,
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

/** Asks the store, once per page view; null when it is off, down, slow or unreadable. */
export function loadStore(now = Date.now()): Promise<ConfigReadBody | null> {
  if (last && now - last.at < REUSE_MS) return last.read;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), STORE_READ_TIMEOUT_MS);
  const read = fetch("/api/config", {
    signal: stop.signal,
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseRead)
    .catch(() => null)
    .then((body) => {
      clearTimeout(timer);
      current = body;
      return body;
    });
  last = { at: now, read };
  return read;
}

/** What the last read found, or null before one answered (or when none could). */
export function storeRead(): ConfigReadBody | null {
  return current;
}
