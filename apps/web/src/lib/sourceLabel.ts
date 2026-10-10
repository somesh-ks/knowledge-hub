import { isWebUrl } from "./safeUrl";

/**
 * The bare host a reader recognises, such as "theverge.com", for the small link that opens a
 * story's source. Returns null for anything that must not become a link, so a caller renders the
 * link only when there is a host to show.
 */
export function sourceHost(url: string | null | undefined): string | null {
  if (!url || !isWebUrl(url)) return null;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return host === "" ? null : host;
}

/**
 * Accessible name for a source link whose visible text is the host alone (the player's). It starts
 * with that text, so a reader using voice control can say what they see.
 */
export function sourceLinkLabel(host: string): string {
  return `${host} (opens in a new tab)`;
}
