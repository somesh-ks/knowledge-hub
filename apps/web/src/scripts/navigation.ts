/**
 * Client-side navigation rules for Astro's ClientRouter. The chrome (app bar, navigation, player)
 * stays put; only the page between them moves, and how it moves says where you went: across to
 * another destination, into one briefing, or back out of it.
 */

/** Root attributes owned by the theme and style, the player and the connection check. A swap would replace them with the new page's. */
export const CARRIED_ATTRIBUTES = [
  "data-theme",
  "data-style",
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

/**
 * On the incoming document alone, for a move to another page: the bar's pill grows in under the new
 * current tab (shell.css). data-astro-nav is no use for that, as it is also on the page that is
 * leaving while the next one is fetched, and would replay the pill under the old tab. A press on a
 * navigation item lights it on the page that is leaving (navigationBoost.ts), with this mark; the
 * incoming page then does not play the growth a second time.
 */
export const ARRIVED_ATTRIBUTE = "data-nav-arrived";

/**
 * Set on the incoming document's root while the pill is still growing when its page arrives: how
 * many milliseconds of the growth have already played, so the new bar picks it up where the old
 * one was cut (shell.css). A cached page swaps in tens of milliseconds after the press; without
 * this the pill stopped a quarter of the way and the new bar drew it whole.
 */
export const PILL_ELAPSED_PROPERTY = "--nav-pill-elapsed";

/** Milliseconds of the pill's growth already played on the page that is leaving, or null if it is not growing. */
export function pillElapsed(root: ParentNode): number | null {
  const indicator = root.querySelector(".app-nav-item[aria-current='page'] .app-nav-indicator");
  for (const animation of indicator?.getAnimations({ subtree: true }) ?? []) {
    if (
      "animationName" in animation &&
      String(animation.animationName).startsWith("nav-pill") &&
      animation.playState === "running"
    ) {
      // A carried growth starts with a negative delay: the time played is the clock less the delay.
      const delay = Number(animation.effect?.getComputedTiming().delay ?? 0);
      return Math.max(0, Math.round(Number(animation.currentTime ?? 0) - delay));
    }
  }
  return null;
}

/** Puts the mark for this move on the incoming document, so it is still there when the move is drawn. */
export function carryNavigationKind(from: HTMLElement, to: HTMLElement): void {
  const kind = from.getAttribute(NAV_ATTRIBUTE);
  if (kind !== null) to.setAttribute(NAV_ATTRIBUTE, kind);
}

export function installNavigation(): void {
  let isNavigating = false;
  // Counts moves begun: a move's marks are cleared only by that move, not by an earlier one still settling.
  let generation = 0;

  document.addEventListener("astro:before-preparation", (event) => {
    isNavigating = true;
    generation += 1;
    const kind = navigationKind(event.from, event.to);
    document.documentElement.setAttribute(NAV_ATTRIBUTE, kind);
  });

  document.addEventListener("astro:before-swap", (event) => {
    carryRootAttributes(document.documentElement, event.newDocument.documentElement);
    carryNavigationKind(document.documentElement, event.newDocument.documentElement);
    const root = document.documentElement;
    const moved =
      root.getAttribute(NAV_ATTRIBUTE) !== "none" && !root.hasAttribute(ARRIVED_ATTRIBUTE);
    if (moved) event.newDocument.documentElement.setAttribute(ARRIVED_ATTRIBUTE, "");
    else {
      // The press lit the item on this page and its pill is still growing: the new bar takes over.
      const elapsed = pillElapsed(document);
      if (elapsed !== null) {
        event.newDocument.documentElement.setAttribute(ARRIVED_ATTRIBUTE, "");
        event.newDocument.documentElement.style.setProperty(PILL_ELAPSED_PROPERTY, `${elapsed}ms`);
      }
    }
    const mine = generation;
    const clear = (): void => {
      if (mine !== generation) return;
      document.documentElement.removeAttribute(NAV_ATTRIBUTE);
      document.documentElement.removeAttribute(ARRIVED_ATTRIBUTE);
      document.documentElement.style.removeProperty(PILL_ELAPSED_PROPERTY);
    };
    // The marks go once the pill has finished, not when the move's own settle time is up: that is
    // shorter than the growth, and removing the mark ends the animation where it stands.
    const settle = (): void => {
      const growing = document
        .querySelector(".app-nav-item[aria-current='page'] .app-nav-indicator")
        ?.getAnimations({ subtree: true })
        .filter((animation) => "animationName" in animation && animation.playState === "running");
      if (growing?.length) {
        void Promise.allSettled(growing.map((animation) => animation.finished)).then(clear);
      } else {
        clear();
      }
    };
    void event.viewTransition.finished.then(settle, settle);
  });

  // On a route change focus moves to the new heading, without scrolling, as a page load would.
  document.addEventListener("astro:page-load", () => {
    if (!isNavigating) return;
    isNavigating = false;
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  });

  // Pressing the destination you are already on takes you back to its top, as a native tab bar does,
  // instead of loading the same page again. From a page below it (a briefing under Library) the
  // press goes to the destination as usual. New episode on the Create page does the same, so the
  // form is not loaded again over what is typed in it; elsewhere it opens the sheet
  // (createEntry.ts). Captured first, so the router never sees it.
  document.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        "a.app-nav-item[aria-current='page'], a.app-nav-create",
      );
      if (!link || !(isSamePage(new URL(link.href), new URL(location.href)) || showsToday(link)))
        return;
      event.preventDefault();
      event.stopPropagation();
      // A key (Enter on the tab) goes there at once: what a key starts is never animated.
      const instant =
        matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.dataset.input === "keyboard";
      window.scrollTo({ top: 0, behavior: instant ? "instant" : "smooth" });
    },
    { capture: true },
  );
}

/**
 * True when the Today tab is pressed on the latest briefing at its dated address: the navigation
 * marks that page as Today, and it shows what Today shows, so the press goes to its top as well.
 */
function showsToday(link: HTMLAnchorElement): boolean {
  return (
    link.matches("[aria-current='page']") &&
    normalize(new URL(link.href).pathname) === "/" &&
    document.querySelector("main[data-latest='true']") !== null
  );
}

/** True when a link points at the page on screen. */
export function isSamePage(link: URL, here: URL): boolean {
  return link.origin === here.origin && normalize(link.pathname) === normalize(here.pathname);
}
