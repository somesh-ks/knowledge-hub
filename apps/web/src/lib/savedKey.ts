/**
 * Where the edits saved in the last few minutes are kept (lib/savedOverlay.ts). On its own so a
 * page's first script can ask whether there are any without loading the rest.
 */
export const SAVED_KEY = "dispatch:saved-edits";

/** Whether anything saved may still be waiting for the build: then the page loads savedView.ts. */
export function hasSaved(): boolean {
  try {
    return localStorage.getItem(SAVED_KEY) !== null;
  } catch {
    return false;
  }
}
