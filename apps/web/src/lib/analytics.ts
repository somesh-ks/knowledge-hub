/**
 * Simple Analytics (D154): cookieless page views and a few named events, on the production site
 * alone. No cookie, no storage, no identifier: the script counts visits, referrers (a shared link's
 * `ref=share` among them), countries from the time zone, and time and scroll on a page. The events
 * below are the loops in docs/specs/analytics.md; each carries a kind, an outcome or an item's id,
 * never anything about the reader. A browser that sends Do Not Track or Global Privacy Control never
 * loads it.
 */

/** Only this host is counted: a preview, a local build and the browser suites load nothing. */
export const ANALYTICS_HOST = "news.someshks.work";
/** Where the script comes from (the policy's script-src). */
export const ANALYTICS_SCRIPT_ORIGIN = "https://scripts.simpleanalyticscdn.com";
/** Where it sends page views and events, by beacon or, without one, an image (connect-src, img-src). */
export const ANALYTICS_QUEUE_ORIGIN = "https://queue.simpleanalyticscdn.com";

export type AnalyticsEvent =
  | "share"
  | "listen_start"
  | "listen_half"
  | "listen_complete"
  | "download"
  | "install"
  | "create_episode"
  | "vote"
  | "story_open";

/** Simple Analytics takes flat text, numbers and booleans; nothing here may name a person. */
export type AnalyticsMetadata = Record<string, string | number | boolean>;

type SaEvent = ((name: string, metadata?: AnalyticsMetadata) => void) & { q?: unknown[][] };

interface AnalyticsWindow {
  sa_event?: SaEvent;
  sa_metadata?: AnalyticsMetadata;
}

/** The query a shared link carries, so a visit it brings in is counted as a share. */
export const SHARE_REF = "share";

/** A shared address with `ref=share` on it, for the visit it brings to be counted as one. */
export function sharedUrl(address: string, base: string): string {
  const url = new URL(address, base);
  url.searchParams.set("ref", SHARE_REF);
  return url.href;
}

/**
 * The briefing or episode a shared address names: its kind and its id (`/d/<id>`, `/e/<id>`), so a
 * share is counted per item. Never anything about a person.
 */
export function sharedItem(url: string): { kind: "briefing" | "episode"; item: string } {
  const [route = "", item = ""] = new URL(url).pathname.split("/").filter(Boolean);
  return { kind: route === "e" ? "episode" : "briefing", item };
}

/**
 * Whether this browser may be counted at all: on the production host, with no Do Not Track or Global
 * Privacy Control. Field Web Vitals (D156) take the same opt-outs.
 */
export function counted(): boolean {
  if (typeof window === "undefined" || window.location.hostname !== ANALYTICS_HOST) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack !== "1" && nav.globalPrivacyControl !== true;
}

/**
 * Counts one event. Safe to call anywhere: off production, with the script blocked (an ad blocker)
 * or before it loads, it queues or does nothing, and it never throws into the action that called it.
 */
export function track(name: AnalyticsEvent, metadata?: AnalyticsMetadata): void {
  if (!counted()) return;
  // Simple Analytics refuses an empty text value, so a field with nothing to say is left out.
  const fields =
    metadata && Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== ""));
  try {
    (window as unknown as AnalyticsWindow).sa_event?.(name, fields);
  } catch {
    // The count is not worth a broken Share or Play.
  }
}

let installed = false;

/**
 * Loads the script once per session (the client router keeps this module, and the script follows
 * its pushState moves as page views). The queue stands in until it arrives, as its own placeholder
 * snippet does, so an event in the first second is not lost; the page metadata goes first because
 * the script reads it once, as it loads.
 */
export function installAnalytics(): void {
  if (installed || !counted()) return;
  installed = true;
  const target = window as unknown as AnalyticsWindow;
  // An installed app is a reader who came back: the one retention signal that needs no identifier.
  target.sa_metadata = { installed: matchMedia("(display-mode: standalone)").matches };
  if (!target.sa_event) {
    const queue: SaEvent = (...args) => {
      queue.q ??= [];
      queue.q.push(args);
    };
    target.sa_event = queue;
  }
  const script = document.createElement("script");
  script.async = true;
  script.src = `${ANALYTICS_SCRIPT_ORIGIN}/latest.js`;
  document.head.append(script);
}
