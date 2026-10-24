/**
 * Share links and the public listen page (D153): the owner's choices in one place. The plan left
 * these open (docs/engineering/engagement-and-share-plan.md, section 7); these are the defaults
 * picked for stage 2. Change a number here and the server, the page and the docs' numbers follow.
 */

/** What can be shared: a briefing and an episode alike. */
export const SHAREABLE_KINDS = ["briefing", "episode"] as const;
/** A link stops working this many days after it is made (Blob keeps audio for 120). */
export const SHARE_EXPIRY_DAYS = 30;
/** Play starts one link may have, all listeners together. */
export const SHARE_PLAYS_PER_LINK = 100;
/**
 * Shared plays stop for the month past this much Blob transfer: play starts times the item's size.
 * Hobby includes 10 GB a month and locks the store past it, which would stop the owner's own playback.
 */
export const SHARE_MONTHLY_BYTES = 4 * 1024 ** 3;
/** Who the listen page says shared it. */
export const SHARE_DISPLAY_NAME = "Somesh";
/** The generation a link the owner sends carries (stage 3 counts it up as it is sent on). */
export const SHARE_FIRST_GENERATION = 1;

/** The listen page's path for a token. */
export const listenPath = (token: string): string => `/s/${token}`;

/**
 * The address a share sends: the listen page with `ref=share` (D154's attribution) and the link's
 * generation `g`. The token is in the path, never in a query an analytics event would carry.
 */
export function listenUrl(
  origin: string,
  token: string,
  generation = SHARE_FIRST_GENERATION,
): string {
  const url = new URL(listenPath(token), origin);
  url.searchParams.set("ref", "share");
  url.searchParams.set("g", String(generation));
  return url.href;
}

/** The line Share answers when an item's audio is not all stored yet. */
export const NOT_STORED_COPY = "Play it once to finish its audio, then share.";
