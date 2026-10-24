import type { AnalyticsMetadata } from "./analytics";

/**
 * What the public listen page tells Simple Analytics (D153, plan section 4). Its page views and
 * events report the path `/s`, never `/s/<token>`: a public dashboard would publish working links.
 * The events carry D154's metadata plus `surface`, `generation` and `item`, nothing about a listener.
 */

/** The path every page view and event of a listen page reports. */
export const LISTEN_PATH = "/s";
/** A link's generation is counted from 1 (the owner's) and stops at this. */
export const MAX_GENERATION = 9;

/** The link's generation from its query (`g`), 1 when it is missing or not a number. */
export function listenGeneration(search: string): number {
  const value = Number.parseInt(new URLSearchParams(search).get("g") ?? "", 10);
  return Number.isFinite(value) ? Math.min(MAX_GENERATION, Math.max(1, value)) : 1;
}

/** The metadata of a listen page's `listen_*` events: the item's id, never the token. */
export function listenMetadata(item: string, kind: string, search: string): AnalyticsMetadata {
  return { kind, surface: "listen", generation: listenGeneration(search), item };
}
