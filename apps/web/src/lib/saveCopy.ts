/**
 * What the settings say about saving (D331). One home, and plain: what happened to the person's
 * change, then what happens next. No server words (crashed, turned down, request), no hosts, no
 * "Not saved yet" as an error. A change made without a connection is kept and goes out by itself, so
 * it is said as good news.
 */

/** Spoken, never shown: a save that went through needs no toast, the control already shows it. */
export const SAVED = "Settings saved";

/** The site could not be reached and the change was kept on this device (lib/outbox.ts). */
export const KEPT = "Saved. It will sync when you're back online.";

/** Said once, when changes kept on this device reach the site. */
export const SYNCED = "Your changes are synced";

/** The edit went through but the site could not change the briefing time. */
export const TIME_REFUSED = "Saved, but the time didn't change.";

/** The sending code could not be fetched and the change could not be kept on this device either. */
export const CANNOT_KEEP = "That didn't save. Try again when you're back online.";

/** What a refusal means, by status. The change is still on the page, and Retry sends it again. */
export const REASONS = {
  0: "That didn't save. Try again when you're back online.",
  400: "That change didn't go through.",
  429: "Too many changes at once. Give it a moment.",
  409: "Changed on another device. Reload to see it.",
  503: "Saving hit a snag. Try again.",
} as const satisfies Record<number, string>;

/** A server failure with no reason of its own, and one that crashed before it could answer. */
export const GENERIC = "That didn't save. Try again.";

/** The line under a page's title while an edit waits for its run to finish. */
export const WAITING = "Will save with your next change.";
