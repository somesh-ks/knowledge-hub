/**
 * Where the edits saved in the last few minutes are kept (lib/savedOverlay.ts). On its own so a
 * page's first script can ask whether there are any without loading the rest.
 */
export const SAVED_KEY = "singularity:saved-edits";

/** Whether anything saved may still be waiting for the build: then the page loads savedView.ts. */
export function hasSaved(): boolean {
  try {
    return localStorage.getItem(SAVED_KEY) !== null;
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
