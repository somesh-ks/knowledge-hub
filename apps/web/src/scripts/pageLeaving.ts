/**
 * Whether the document is going away (a reload, a close, a hard navigation). Chromium rejects a
 * fetch still on its way as the document unloads, `keepalive` or not: the request itself carries on
 * to the server, only the page's promise ends with "Failed to fetch". A save that reads that
 * rejection as a failure takes its change back, so a reload right after a press shows the old state
 * (2026-10-30, D259). A request that ends while the page is leaving is unknown, not failed: the
 * change stays kept, and the next page shows it until the store does.
 *
 * A same-document navigation (the ClientRouter) fires no pagehide, so a page swapped away still
 * hears its answers.
 */
let leaving = false;

export function pageIsLeaving(): boolean {
  return leaving;
}

/** Long enough for pagehide to be dispatched after the rejection it caused. */
const LEAVE_GRACE_MS = 50;

/**
 * For a request that ended with no answer: whether the page was going away. The rejection reaches
 * the page's promise before pagehide has been heard (a microtask checkpoint follows each listener
 * that ran earlier), so the verdict waits a moment. A page that is really going never gets past
 * the wait; one that stays (offline) is told it was not.
 */
export async function endedByLeaving(): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, LEAVE_GRACE_MS));
  return leaving;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "pagehide",
    () => {
      leaving = true;
    },
    { capture: true },
  );
  // A page restored from the back-forward cache is live again.
  window.addEventListener("pageshow", () => {
    leaving = false;
  });
}
