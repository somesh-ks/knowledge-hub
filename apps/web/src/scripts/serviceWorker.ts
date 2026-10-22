/**
 * Registers the service worker after the page has loaded, so it never competes with first paint.
 * An update installs in the background and activates only while nothing is playing, so a new
 * version can never cut off narration. The page is not reloaded either: the next navigation simply
 * uses the new worker's caches. An installed app that comes back to the front with a page from an
 * older deploy loads the current one, unless something is playing (checkBuild below).
 */

/** A waiting worker may take over unless audio is playing or buffering. */
export function shouldActivateUpdate(playerState: string | undefined): boolean {
  return playerState !== "playing" && playerState !== "loading";
}

function activateWhenIdle(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting;
  if (!waiting) return;
  if (shouldActivateUpdate(document.documentElement.dataset.playerState)) {
    waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

/** An installed app can stay open for days, so it asks for a new worker when it comes back, at most this often. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/** Whether enough time has passed since the last check for a new worker. */
export function shouldCheckForUpdate(now: number, lastCheck: number): boolean {
  return now - lastCheck >= UPDATE_CHECK_MS;
}

/** The site's build is asked for at most this often when the app comes back to the front. */
const BUILD_CHECK_MS = 60 * 1000;
const RELOADED_FOR = "dispatch:build-reload";

/**
 * Whether the page on screen is from an older deploy than the site and should be loaded again: not
 * while narration plays, and once per build, so a page the network cannot replace (a slow answer
 * the worker gave up on) is not reloaded in a loop.
 */
function shouldReloadForBuild(
  pageBuild: string | undefined,
  siteBuild: unknown,
  playerState: string | undefined,
  reloadedFor: string | null,
): boolean {
  if (!pageBuild || typeof siteBuild !== "string" || !siteBuild) return false;
  if (siteBuild === pageBuild || siteBuild === reloadedFor) return false;
  return shouldActivateUpdate(playerState);
}

/** What a reload would throw away, as readPageWork reads it from the page. */
export interface PageWork {
  /** `document.querySelector`, which throws for a selector the browser does not know. */
  query: (selector: string) => unknown;
  /** The focused element is a field the reader types in. */
  typing: boolean;
  /**
   * Each text field: its value now, and its value when the reader first focused it (undefined when
   * they never did). A script that fills a field from saved state on load (a passphrase, a search
   * from ?q, a source filter) changes its value without the reader editing anything.
   */
  fields: ReadonlyArray<{ value: string; start: string | undefined }>;
}

/**
 * Whether the page holds something a reload would throw away: an open dialog, menu or toast (the
 * Undo of a removal waiting to be sent), a field being typed in, or text the reader changed and has
 * not sent. A browser without popovers (iOS 16 Safari) throws on `:popover-open`; that must not
 * stop the check, and such a browser has no open popover anyway.
 */
export function holdsWork(page: PageWork): boolean {
  if (page.query("dialog[open]")) return true;
  try {
    if (page.query(":popover-open")) return true;
  } catch {
    // No popovers in this browser.
  }
  if (page.typing) return true;
  return page.fields.some((field) => field.start !== undefined && field.value !== field.start);
}

/** Fields the reader types in. A range, checkbox or select takes effect as it changes. */
const TEXT_FIELD =
  "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=tel], input[type=password], input[type=number]";

/** A text field's value when the reader first focused it. A sent or reset form forgets its fields. */
const fieldStart = new WeakMap<Element, string>();

function trackEdits(): void {
  document.addEventListener(
    "focusin",
    (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
      if (field.matches(TEXT_FIELD) && !fieldStart.has(field)) fieldStart.set(field, field.value);
    },
    true,
  );
  const forget = (event: Event): void => {
    if (!(event.target instanceof HTMLFormElement)) return;
    for (const field of event.target.elements) fieldStart.delete(field);
  };
  document.addEventListener("submit", forget, true);
  document.addEventListener("reset", forget, true);
}

function readPageWork(): PageWork {
  return {
    query: (selector) => document.querySelector(selector),
    typing: Boolean(document.activeElement?.matches(`${TEXT_FIELD}, [contenteditable]`)),
    fields: [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TEXT_FIELD)].map(
      (field) => ({ value: field.value, start: fieldStart.get(field) }),
    ),
  };
}

/**
 * Asks the site which build it serves and loads it when the page on screen is older. A page that
 * holds work is left alone and the answer is `true`: the next return asks again, and a full
 * navigation picks up the deploy by itself.
 */
async function checkBuild(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (!navigator.onLine) return false;
  const pageBuild =
    document.querySelector<HTMLMetaElement>('meta[name="dispatch-build"]')?.content || undefined;
  const response = await fetch("/build.json", { cache: "no-store" });
  if (!response.ok) return false;
  const siteBuild = ((await response.json()) as { build?: unknown }).build;
  let reloadedFor: string | null = null;
  try {
    reloadedFor = sessionStorage.getItem(RELOADED_FOR);
  } catch {
    // Storage blocked: no reload, since nothing would stop a second one.
    return false;
  }
  const playerState = document.documentElement.dataset.playerState;
  if (!shouldReloadForBuild(pageBuild, siteBuild, playerState, reloadedFor)) return false;
  if (holdsWork(readPageWork())) return true;
  sessionStorage.setItem(RELOADED_FOR, String(siteBuild));
  // The deploy may carry a new worker too. The reload's page load goes to the network either way.
  await registration.update().catch(() => {});
  location.reload();
  return false;
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  activateWhenIdle(registration);
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", () => activateWhenIdle(registration));
  });
  // Try again whenever the page is hidden, so an update that waited out a long listen still lands.
  let lastCheck = Date.now();
  let lastBuildCheck = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      activateWhenIdle(registration);
      return;
    }
    if (Date.now() - lastBuildCheck >= BUILD_CHECK_MS) {
      lastBuildCheck = Date.now();
      checkBuild(registration)
        .then((deferred) => {
          // A page that held work is asked about again on the next return, not after the wait.
          if (deferred) lastBuildCheck = 0;
        })
        .catch(() => {
          // Offline or a failed read: the page on screen stays, and the next return asks again.
        });
    }
    if (shouldCheckForUpdate(Date.now(), lastCheck)) {
      lastCheck = Date.now();
      registration.update().catch(() => {
        // Offline: the next visit asks again.
      });
    }
  });
}

export function registerServiceWorker(): void {
  // Development serves unhashed modules that a cache would keep stale.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  trackEdits();
  const register = (): void => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(watchForUpdates)
      .catch(() => {
        // Offline support is an enhancement. Reading works without it.
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
