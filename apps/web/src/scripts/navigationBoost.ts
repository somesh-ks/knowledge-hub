/**
 * What makes a move between destinations feel immediate. Loaded when the page is idle, so none of it
 * costs anything at first paint:
 *
 *   - the destination lights up on the press itself, before the page arrives;
 *   - the new page is shown at once, without the two frames a view transition spends taking
 *     pictures of the page first;
 *   - a finger going down on a link starts fetching it, a tenth of a second before the tap ends;
 *   - the destinations stay saved while the app is in use, so the service worker can answer at once;
 *   - a page that changed behind its saved copy is swapped in quietly, if it has not been touched.
 */

import { whenIdle } from "./idle";
import { ARRIVED_ATTRIBUTE } from "./navigation";

/** Links only: the side column also has a button (the queue's row), which has no page to go to. */
const NAV_ITEM = "a.app-nav-item";
const NAV_BRAND = ".app-nav-brand";
/** Root attribute that says the page itself, not a view transition, draws this move. */
export const SWAP_ATTRIBUTE = "data-nav-swap";
/** Longer than the page's own entrance (300 ms, view-transitions.css), so the marks come off after it has ended. */
const SWAP_SETTLE_MS = 350;
/** The destinations are fetched again at most this often when the app comes back to the front. */
export const WARM_EVERY_MS = 60_000;

/** The navigation item a press on `source` leads to: the item itself, or the wordmark's twin. */
export function pressedDestination(
  source: Element | null | undefined,
  root: ParentNode,
): HTMLAnchorElement | null {
  if (!source) return null;
  const item = source.closest<HTMLAnchorElement>(NAV_ITEM);
  if (item) return item;
  const brand = source.closest<HTMLAnchorElement>(NAV_BRAND);
  if (!brand) return null;
  for (const candidate of root.querySelectorAll<HTMLAnchorElement>(NAV_ITEM)) {
    if (candidate.getAttribute("href") === brand.getAttribute("href")) return candidate;
  }
  return null;
}

/** Marks one navigation item as the current page and clears the others. */
export function markCurrent(item: HTMLAnchorElement, root: ParentNode): void {
  for (const other of root.querySelectorAll(`${NAV_ITEM}[aria-current]`)) {
    if (other !== item) other.removeAttribute("aria-current");
  }
  item.setAttribute("aria-current", "page");
}

/** The pages worth keeping saved: every destination except the one on screen. */
export function destinationsToWarm(root: ParentNode): string[] {
  const hrefs: string[] = [];
  for (const item of root.querySelectorAll<HTMLAnchorElement>(NAV_ITEM)) {
    if (item.getAttribute("aria-current") !== "page") hrefs.push(item.href);
  }
  return hrefs;
}

/** A page that changed behind its saved copy replaces the one on screen only if nobody has used it. */
export function shouldRefresh(
  message: unknown,
  page: { path: string; touched: boolean; hidden: boolean },
): boolean {
  if (typeof message !== "object" || message === null) return false;
  const { type, path } = message as { type?: unknown; path?: unknown };
  return type === "PAGE_CHANGED" && path === page.path && !page.touched && !page.hidden;
}

/** The longest a pressed card holds its press while its page is on the way. */
export const PENDING_MAX_MS = 6_000;

/** The timer that will end each card's held press, so a second press on the card restarts the wait. */
const pendingTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

/** A card opened from a list stays pressed (library.css) until its page arrives; the swap removes it. */
export function holdPress(card: Element): void {
  const earlier = pendingTimers.get(card);
  if (earlier !== undefined) clearTimeout(earlier);
  card.setAttribute("data-pending", "");
  // A move that never completes (the page could not be fetched) leaves the card as it was.
  pendingTimers.set(
    card,
    setTimeout(() => {
      card.removeAttribute("data-pending");
      pendingTimers.delete(card);
    }, PENDING_MAX_MS),
  );
}

/** The most pages the Library fetches ahead in one visit to the app: the cards a person is looking at. */
export const LOOKAHEAD_LIMIT = 8;

/** How long after a finger leaves an item its click still counts as that press. */
const PRESS_CLICK_MS = 800;
/** The navigation item a finger or pen last pressed, and when it last touched it. */
let fingerOn: { item: Element; at: number } | null = null;

/**
 * The value of the arrival mark for a press on `item`: "pressed" when a finger went down on it a
 * moment ago, so its pill is already showing and eases from the press tone to the current one
 * instead of growing a second time; empty otherwise.
 */
export function arrivalFor(item: Element, now: number): string {
  return fingerOn?.item === item && now - fingerOn.at < PRESS_CLICK_MS ? "pressed" : "";
}

/** The transitions this module made, so a swap can tell whether the page or the browser draws it. */
const immediate = new WeakSet<object>();

/** True for a transition made by immediateTransition, false for the browser's own. */
export function isImmediate(transition: unknown): boolean {
  return typeof transition === "object" && transition !== null && immediate.has(transition);
}

/**
 * Stands in for document.startViewTransition and makes the change at once. A view transition takes
 * a picture of the old page and one of the new before anything moves; a move between pages does not
 * need them, because the incoming page fades up by itself (view-transitions.css).
 */
export function immediateTransition(update?: () => unknown): ViewTransition {
  const done = Promise.resolve()
    .then(() => update?.())
    .then(() => undefined);
  const finished = done.then(
    () => new Promise<undefined>((resolve) => setTimeout(resolve, SWAP_SETTLE_MS)),
  );
  const transition = {
    updateCallbackDone: done,
    ready: done,
    finished,
    skipTransition: () => undefined,
    types: new Set<string>(),
  } as unknown as ViewTransition;
  immediate.add(transition);
  return transition;
}

function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function quietFetch(href: string, priority: RequestPriority): void {
  void fetch(href, { priority, headers: { accept: "text/html" } }).catch(() => {
    // A fetch made ahead of need: its failure changes nothing.
  });
}

export function installNavigationBoost(): void {
  const restoreViewTransitions = (): void => {
    // Removing the stand-in from the document uncovers the browser's own method again.
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  };

  document.addEventListener("astro:before-preparation", (event) => {
    const opened = event.sourceElement?.closest<HTMLElement>("a.card-link");
    if (opened) holdPress(opened);
    const item = pressedDestination(event.sourceElement, document);
    if (item) {
      // The pill grows under the item as it lights, here, and not again on the page that arrives.
      if (item.getAttribute("aria-current") !== "page") {
        const root = document.documentElement;
        root.setAttribute(ARRIVED_ATTRIBUTE, arrivalFor(item, performance.now()));
      }
      markCurrent(item, document);
    }
    // Without the API the router swaps at once anyway.
    if (!document.startViewTransition) return;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      writable: true,
      // Good for one call, the router's: a theme change later gets the browser's own.
      value: (update?: () => unknown): ViewTransition => {
        restoreViewTransitions();
        return immediateTransition(update);
      },
    });
  });

  document.addEventListener("astro:before-swap", (event) => {
    restoreViewTransitions();
    // Only a move this module made immediate is drawn by the page; any other has its pictures.
    if (!isImmediate(event.viewTransition)) return;
    // navigation.ts marked the kind of move on the page that is leaving. The mark that starts the
    // fade goes on the incoming document alone: set any earlier, the page that is leaving would
    // blink out and fade back in while its replacement is on the way.
    const kind = document.documentElement.getAttribute("data-astro-nav");
    if (kind === null) return;
    event.newDocument.documentElement.setAttribute(SWAP_ATTRIBUTE, kind);
    const clear = (): void => document.documentElement.removeAttribute(SWAP_ATTRIBUTE);
    void event.viewTransition.finished.then(clear, clear);
  });

  // Which item a finger is on, for the pill: see arrivalFor.
  for (const type of ["pointerdown", "pointerup"] as const) {
    document.addEventListener(
      type,
      (event) => {
        if (event.pointerType === "mouse") return;
        const target = event.target instanceof Element ? event.target : null;
        const item = target?.closest(NAV_ITEM) ?? null;
        fingerOn = item ? { item, at: performance.now() } : null;
      },
      { capture: true, passive: true },
    );
  }

  // Touch has no hover to prefetch on. The service worker shares this request with the router's.
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" || !navigator.onLine || savesData()) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>("a[data-astro-prefetch]");
      if (link && link.origin === location.origin && link.pathname !== location.pathname) {
        quietFetch(link.href, "high");
      }
    },
    { capture: true, passive: true },
  );

  // The Library's cards in view are fetched at low priority while the page is idle: a card's page
  // is drawn at the edge once per content change, and the first tap after that waited on the
  // function in Washington (owner, 2026-11-02: "there's a delay to go to the page"). The fetch
  // fills the edge nearest the owner and the worker's saved copy, so the tap finds the page ready.
  // Few, and once each: a phone scrolling a long Library asks for at most LOOKAHEAD_LIMIT pages.
  const lookedAhead = new Set<string>();
  let cardWatcher: IntersectionObserver | null = null;
  const watchCards = (): void => {
    cardWatcher?.disconnect();
    cardWatcher = null;
    // The Library page alone: Settings' Saved and Downloads draw the same cards, and would spend the cap.
    if (document.documentElement.getAttribute("data-library-page") !== "items") return;
    if (!("IntersectionObserver" in window) || !navigator.onLine || savesData()) return;
    const cards = document.querySelectorAll<HTMLAnchorElement>(
      "[data-library] a.card-link[href^='/e/'], [data-library] a.card-link[href^='/d/']",
    );
    if (cards.length === 0) return;
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const link = entry.target as HTMLAnchorElement;
        watcher.unobserve(link);
        // Idle, and the cap and the once-each rule are read when the work runs, not when it is queued.
        whenIdle(() => {
          if (lookedAhead.size >= LOOKAHEAD_LIMIT || lookedAhead.has(link.href)) return;
          lookedAhead.add(link.href);
          quietFetch(link.href, "low");
        });
      }
    });
    cardWatcher = watcher;
    for (const card of cards) watcher.observe(card);
  };
  watchCards();
  document.addEventListener("astro:page-load", watchCards);

  let warmedAt = 0;
  const warm = (): void => {
    if (!navigator.onLine || savesData() || !navigator.serviceWorker?.controller) return;
    if (Date.now() - warmedAt < WARM_EVERY_MS) return;
    warmedAt = Date.now();
    for (const href of destinationsToWarm(document)) quietFetch(href, "low");
  };
  warm();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) warm();
  });
  // On a first visit the worker takes control a moment after load.
  navigator.serviceWorker?.addEventListener("controllerchange", warm);

  let touched = false;
  const touch = (): void => {
    touched = true;
  };
  document.addEventListener("astro:page-load", () => {
    touched = false;
  });
  for (const type of ["pointerdown", "keydown", "wheel", "touchmove"] as const) {
    addEventListener(type, touch, { capture: true, passive: true });
  }
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const page = { path: location.pathname, touched, hidden: document.hidden };
    if (!shouldRefresh(event.data, page)) return;
    void import("astro:transitions/client").then(({ navigate }) =>
      navigate(location.href, { history: "replace" }),
    );
  });
}
