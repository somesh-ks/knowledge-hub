/**
 * Client-side navigation rules for Astro's ClientRouter. The chrome (app bar, navigation, player)
 * stays put; only the page between them moves, and how it moves says where you went: across to
 * another destination, into one briefing, or back out of it.
 */

/** Root attributes owned by the theme, the player and the connection check. A swap would replace them with the new page's. */
export const CARRIED_ATTRIBUTES = [
  "data-theme",
  "data-offline",
  "data-mini",
  "data-player",
  "data-player-state",
  "data-run",
] as const;

/**
 * "peer": between two pages at the same level, a fade through. "in": into one dated briefing, the
 * page settles from the end side. "out": back out of one, from the start side. "none": no move.
 */
export type NavigationKind = "peer" | "in" | "out" | "none";

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** A dated briefing or an episode: one level below the destinations in the navigation. */
function isBriefingPath(pathname: string): boolean {
  return pathname.startsWith("/d/") || pathname.startsWith("/e/");
}

export function navigationKind(from: URL, to: URL): NavigationKind {
  const fromPath = normalize(from.pathname);
  const toPath = normalize(to.pathname);
  if (fromPath === toPath) return "none";
  const fromBriefing = isBriefingPath(fromPath);
  const toBriefing = isBriefingPath(toPath);
  if (toBriefing && !fromBriefing) return "in";
  if (fromBriefing && !toBriefing) return "out";
  return "peer";
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

/**
 * Marks the root so the stylesheet can pick the move. The swap replaces the root's attributes with
 * the new page's (Astro keeps only its own fixed few), and the move is drawn after the swap, so the
 * mark is carried onto the incoming document like the others.
 */
export const NAV_ATTRIBUTE = "data-astro-nav";

/** Puts the mark for this move on the incoming document, so it is still there when the move is drawn. */
export function carryNavigationKind(from: HTMLElement, to: HTMLElement): void {
  const kind = from.getAttribute(NAV_ATTRIBUTE);
  if (kind !== null) to.setAttribute(NAV_ATTRIBUTE, kind);
}

export function installNavigation(): void {
  let isNavigating = false;

  document.addEventListener("astro:before-preparation", (event) => {
    isNavigating = true;
    const kind = navigationKind(event.from, event.to);
    document.documentElement.setAttribute(NAV_ATTRIBUTE, kind);
  });

  document.addEventListener("astro:before-swap", (event) => {
    carryRootAttributes(document.documentElement, event.newDocument.documentElement);
    carryNavigationKind(document.documentElement, event.newDocument.documentElement);
    const clear = (): void => document.documentElement.removeAttribute(NAV_ATTRIBUTE);
    void event.viewTransition.finished.then(clear, clear);
  });

  // On a route change focus moves to the new heading, without scrolling, as a page load would.
  document.addEventListener("astro:page-load", () => {
    if (!isNavigating) return;
    isNavigating = false;
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  });

  // Pressing the destination you are already on takes you back to its top, as a native tab bar does,
  // instead of loading the same page again. From a page below it (a briefing under Library) the
  // press goes to the destination as usual. Captured first, so the router never sees it.
  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a.app-nav-item[aria-current='page']",
      );
      if (!link || !isSamePage(new URL(link.href), new URL(location.href))) return;
      event.preventDefault();
      event.stopPropagation();
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "instant" : "smooth" });
    },
    { capture: true },
  );
}

/** True when a link points at the page on screen. */
export function isSamePage(link: URL, here: URL): boolean {
  return link.origin === here.origin && normalize(link.pathname) === normalize(here.pathname);
}
