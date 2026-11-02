/**
 * Client-side navigation rules for Astro's ClientRouter. The chrome (app bar, navigation, player)
 * stays put; only the page between them moves, and how it moves says where you went: across to
 * another destination, into one briefing, or back out of it.
 */

/** Root attributes owned by the theme and style, the player and the connection check (the strip's own mark included, so a swap never lets the page up and down again). A swap would replace them with the new page's. */
export const CARRIED_ATTRIBUTES = [
  "data-theme",
  "data-style",
  "data-offline",
  "data-strip",
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

/** Where the person came from: the tab lit on the page they left, kept per briefing or episode for the visit. */
const ORIGIN_KEY = "singularity:tab-origin";
const ORIGIN_LIMIT = 24;
export type TabOrigins = Record<string, string>;

const NAV_ITEM_SELECTOR = "a.app-nav-item";

/** The address of the tab lit in the bar, or null when the page belongs to none. */
export function currentTab(root: ParentNode): string | null {
  return (
    root.querySelector(`${NAV_ITEM_SELECTOR}[aria-current='page']`)?.getAttribute("href") ?? null
  );
}

/**
 * Remembers which tab led to a briefing or an episode, or forgets it when no tab did. A briefing
 * opened from the Library stays under the Library, one opened from Settings under Settings: the
 * tab says where you are in the app, and a podcast is the same podcast from every one of them.
 */
export function rememberTab(origins: TabOrigins, path: string, tab: string | null): TabOrigins {
  const { [path]: _gone, ...rest } = origins;
  if (tab === null) return rest;
  // Newest last, so the oldest go when the visit has opened more than it can use again.
  return Object.fromEntries(Object.entries({ ...rest, [path]: tab }).slice(-ORIGIN_LIMIT));
}

/**
 * Lights `tab` in the bar of `doc` instead of the page's own, and gives the Back button, which a
 * page that is itself a tab hides, the tab to go back to. A tab the bar does not have changes nothing.
 */
export function lightTab(doc: ParentNode, tab: string): void {
  const items = [...doc.querySelectorAll<HTMLAnchorElement>(NAV_ITEM_SELECTOR)];
  const item = items.find((candidate) => candidate.getAttribute("href") === tab);
  if (!item || item.getAttribute("aria-current") === "page") return;
  for (const other of items) other.removeAttribute("aria-current");
  item.setAttribute("aria-current", "page");
  const back = doc.querySelector<HTMLAnchorElement>("a[data-back][hidden]");
  if (back) {
    back.removeAttribute("hidden");
    back.setAttribute("href", tab);
  }
}

function readOrigins(): TabOrigins {
  try {
    const stored = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) ?? "{}") as unknown;
    return typeof stored === "object" && stored !== null ? (stored as TabOrigins) : {};
  } catch {
    return {};
  }
}

function writeOrigins(origins: TabOrigins): void {
  try {
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origins));
  } catch {
    // Storage is off: the page keeps the tab it was built with.
  }
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
 * The animation clock's time at which the pill under the current tab began to grow, or null if it is
 * not growing. The new bar carries on from the same instant (startTime, not a count of milliseconds
 * played): a swap takes tens of milliseconds, and a count taken before it would take the pill back
 * by that much, so it grew a second time on the new bar.
 */
export function pillStartedAt(root: ParentNode): number | null {
  const indicator = root.querySelector(".app-nav-item[aria-current='page'] .app-nav-indicator");
  for (const animation of indicator?.getAnimations({ subtree: true }) ?? []) {
    if (
      "animationName" in animation &&
      String(animation.animationName).startsWith("nav-pill") &&
      animation.playState === "running" &&
      animation.startTime !== null
    ) {
      return Number(animation.startTime);
    }
  }
  return null;
}

/** Which way a move goes along the bar: "next" to a tab further along it, "prev" to one before it. */
export type TabDirection = "next" | "prev";
export const DIRECTION_ATTRIBUTE = "data-nav-dir";

/**
 * The way a move goes. A way into a briefing or an episode is "next", the way out "prev", and
 * between destinations it follows the bar, so the page arrives from the side its tab sits on.
 * Null when the bar does not say (a page that belongs to no tab, or the same tab).
 */
export function moveDirection(
  kind: NavigationKind,
  leavingTab: string | null,
  arrivingTab: string | null,
  barOrder: readonly (string | null)[],
): TabDirection | null {
  if (kind === "in") return "next";
  if (kind === "out") return "prev";
  if (kind !== "peer" || leavingTab === null || arrivingTab === null) return null;
  const from = barOrder.indexOf(leavingTab);
  const to = barOrder.indexOf(arrivingTab);
  if (from < 0 || to < 0 || from === to) return null;
  return to > from ? "next" : "prev";
}

/** Puts the mark for this move on the incoming document, so it is still there when the move is drawn. */
export function carryNavigationKind(from: HTMLElement, to: HTMLElement): void {
  const kind = from.getAttribute(NAV_ATTRIBUTE);
  if (kind !== null) to.setAttribute(NAV_ATTRIBUTE, kind);
}

export function installNavigation(): void {
  // A reload of a briefing keeps the tab it was opened under.
  const here = normalize(location.pathname);
  const opened = isBriefingPath(here) ? readOrigins()[here] : undefined;
  if (opened) lightTab(document, opened);

  let isNavigating = false;
  // Counts moves begun: a move's marks are cleared only by that move, not by an earlier one still settling.
  let generation = 0;
  // Where the leaving bar's pill was in its growth, until the new bar has taken it over.
  let carriedPill: number | null = null;
  // The tab of the page on screen. Set when a page arrives, never on a press: a press lights its
  // destination on the page still showing, and a second press before the first lands would read that.
  let leavingTab: string | null = currentTab(document);

  document.addEventListener("astro:before-preparation", (event) => {
    isNavigating = true;
    generation += 1;
    const kind = navigationKind(event.from, event.to);
    document.documentElement.setAttribute(NAV_ATTRIBUTE, kind);
    const to = normalize(event.to.pathname);
    // Going back to a briefing is not a way in: it keeps the tab it was opened under.
    if (isBriefingPath(to) && event.navigationType !== "traverse") {
      writeOrigins(rememberTab(readOrigins(), to, currentTab(document)));
    }
  });

  // The new bar is in the page and not yet drawn: its pill takes up the growth at the instant the old one reached.
  document.addEventListener("astro:after-swap", () => {
    leavingTab = currentTab(document);
    if (carriedPill === null) return;
    const started = carriedPill;
    carriedPill = null;
    const indicator = document.querySelector(
      ".app-nav-item[aria-current='page'] .app-nav-indicator",
    );
    for (const animation of indicator?.getAnimations({ subtree: true }) ?? []) {
      if ("animationName" in animation && String(animation.animationName).startsWith("nav-pill")) {
        animation.startTime = started;
      }
    }
  });

  document.addEventListener("astro:before-swap", (event) => {
    carryRootAttributes(document.documentElement, event.newDocument.documentElement);
    carryNavigationKind(document.documentElement, event.newDocument.documentElement);
    const path = normalize(event.to.pathname);
    const opened = isBriefingPath(path) ? readOrigins()[path] : undefined;
    if (opened) lightTab(event.newDocument, opened);
    const root = document.documentElement;
    // Which side the page arrives from. A key moves nothing: what a key starts is never animated.
    if (root.dataset.input !== "keyboard") {
      const bar = [...document.querySelectorAll<HTMLAnchorElement>(NAV_ITEM_SELECTOR)].map((item) =>
        item.getAttribute("href"),
      );
      const direction = moveDirection(
        navigationKind(event.from, event.to),
        leavingTab,
        currentTab(event.newDocument),
        bar,
      );
      if (direction) event.newDocument.documentElement.setAttribute(DIRECTION_ATTRIBUTE, direction);
    }
    // The same tab stays lit through the move (the Library, into one of its episodes): its pill has nothing to grow.
    const tab = currentTab(event.newDocument);
    const moved =
      root.getAttribute(NAV_ATTRIBUTE) !== "none" &&
      !root.hasAttribute(ARRIVED_ATTRIBUTE) &&
      (tab === null || tab !== currentTab(document));
    if (moved) event.newDocument.documentElement.setAttribute(ARRIVED_ATTRIBUTE, "");
    else {
      // The press lit the item on this page and its pill is still growing: the new bar takes over.
      const started = pillStartedAt(document);
      if (started !== null) {
        event.newDocument.documentElement.setAttribute(
          ARRIVED_ATTRIBUTE,
          root.getAttribute(ARRIVED_ATTRIBUTE) ?? "",
        );
        carriedPill = started;
      }
    }
    const mine = generation;
    const clear = (): void => {
      if (mine !== generation) return;
      document.documentElement.removeAttribute(NAV_ATTRIBUTE);
      document.documentElement.removeAttribute(ARRIVED_ATTRIBUTE);
      document.documentElement.removeAttribute(DIRECTION_ATTRIBUTE);
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
