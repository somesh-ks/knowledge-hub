import type { AnalyticsMetadata } from "./analytics";
import { listenUrl } from "./share";

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

/** The generation a listener's Send it to someone carries: one past the page's own, at most 9. */
export function nextGeneration(search: string): number {
  return Math.min(MAX_GENERATION, listenGeneration(search) + 1);
}

/**
 * The address Send it to someone shares: the same link with `ref=share` and `g` one higher (plan
 * section 5), so a link's travel is counted per generation with no new token and no server write.
 */
export function sendOnUrl(href: string): string {
  const url = new URL(href);
  return listenUrl(url.origin, url.pathname.split("/")[2] ?? "", nextGeneration(url.search));
}

/** The metadata of a listen page's `share`: how it went, the page's own generation and the item. */
export function listenShareMetadata(
  item: string,
  outcome: "shared" | "copied",
  search: string,
): AnalyticsMetadata {
  return { outcome, surface: "listen", generation: listenGeneration(search), item };
}

/** The metadata of a listen page's `react`: Worth it (up) or Not for me (down), and the item. */
export function listenReactMetadata(item: string, value: "up" | "down"): AnalyticsMetadata {
  return { value, surface: "listen", item };
}
