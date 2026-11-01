/**
 * Where the edits saved in the last few minutes are kept (lib/savedOverlay.ts). On its own so a
 * page's first script can ask whether there are any without loading the rest.
 */
export const SAVED_KEY = "singularity:saved-edits";

/**
 * Where the edits that could not be sent are kept until the connection is back (lib/outbox.ts). Unlike
 * the saved edits above they do not expire after minutes: they are the only copy.
 */
export const OUTBOX_KEY = "singularity:outbox";

/** Whether this device holds edits it has yet to send (CFG-04). */
export function hasOutbox(): boolean {
  try {
    return localStorage.getItem(OUTBOX_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Whether anything saved may still be waiting for the build, or an edit for the connection: then the
 * page loads savedView.ts.
 */
export function hasSaved(): boolean {
  try {
    return localStorage.getItem(SAVED_KEY) !== null || hasOutbox();
  } catch {
    return false;
  }
}

/**
 * Whether the owner's config is in the store (D149): then a settings page asks /api/config for what
 * it holds and lays it over the copy it was built with (scripts/configStoreRead.ts), before the
 * editor reads its starting point. The build says so in a meta tag; without it nothing is asked.
 */
export function storeOn(): boolean {
  return document.querySelector('meta[name="singularity-config-store"]') !== null;
}
