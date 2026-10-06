/**
 * Client-side navigation rules for Astro's ClientRouter. A view transition is used only for the hop
 * between the reader and the archive; every other navigation swaps at once (design spec section 7).
 */

/** Root attributes owned by the theme, the player and the connection check. A swap would replace them with the new page's. */
export const CARRIED_ATTRIBUTES = [
  "data-theme",
  "data-offline",
  "data-mini",
  "data-player",
  "data-player-state",
] as const;

export type NavigationKind = "archive" | "none";

function isArchivePath(pathname: string): boolean {
  return pathname === "/archive" || pathname === "/archive/";
}

/** The archive hop is any navigation where exactly one end is the archive. */
export function navigationKind(from: URL, to: URL): NavigationKind {
  return isArchivePath(from.pathname) !== isArchivePath(to.pathname) ? "archive" : "none";
}

/**
 * Copies the carried attributes from the live root onto the incoming document, so a swap never
 * resets the theme or the player's state.
 */
export function carryRootAttributes(from: HTMLElement, to: HTMLElement): void {
  for (const name of CARRIED_ATTRIBUTES) {
    const value = from.getAttribute(name);
    if (value === null) to.removeAttribute(name);
    else to.setAttribute(name, value);
  }
}

/** Marks the root so the stylesheet can animate the archive hop and nothing else. */
const NAV_ATTRIBUTE = "data-astro-nav";

export function installNavigation(): void {
  let isNavigating = false;

  document.addEventListener("astro:before-preparation", (event) => {
    isNavigating = true;
    const kind = navigationKind(event.from, event.to);
    document.documentElement.setAttribute(NAV_ATTRIBUTE, kind);
  });

  document.addEventListener("astro:before-swap", (event) => {
    carryRootAttributes(document.documentElement, event.newDocument.documentElement);
    const clear = (): void => document.documentElement.removeAttribute(NAV_ATTRIBUTE);
    void event.viewTransition.finished.then(clear, clear);
  });

  // On a route change focus moves to the new heading, without scrolling, as a page load would.
  document.addEventListener("astro:page-load", () => {
    if (!isNavigating) return;
    isNavigating = false;
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  });
}
