/**
 * Registers the service worker after the page has loaded, so it never competes with first paint.
 * An update installs in the background and activates only while nothing is playing, so a new
 * version can never cut off narration. A page from an older deploy loads the current one by itself
 * (applyBuild), at the first moment nothing would be lost; there is no prompt to answer (D202).
 */

import { wasTypedIn } from "./typing";

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

/** The site's build is asked for at most this often, on load, on each return to the front and while the page stays open. */
const BUILD_CHECK_MS = 60 * 1000;
/** While the page stays in front, the site's build is asked for this often. */
const BUILD_POLL_MS = 10 * 60 * 1000;
/** A newer build waiting for a safe moment is tried again this often. */
const APPLY_RETRY_MS = 5 * 1000;
/** One build is loaded for this many times in a tab: a reload that still shows the old build (a stale edge copy) must not loop. */
export const APPLY_ATTEMPTS = 2;
const APPLIED_KEY = "singularity:applied-build";

/** What the page is doing when a reload is considered. */
export interface Moment {
  playerState: string | undefined;
  /** A dialog, sheet or popover (a menu, a toast with an Undo waiting) is open. */
  overlayOpen: boolean;
  /** A text field has focus, or holds something the reader typed (not something the page filled in). */
  editing: boolean;
}

/** A reload throws away the page's state, so it waits until the reader has nothing on it to lose. */
export function canReloadNow(moment: Moment): boolean {
  return shouldActivateUpdate(moment.playerState) && !moment.overlayOpen && !moment.editing;
}

const TEXT_FIELD =
  'textarea, input:not([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"], [type="range"], [type="hidden"], [type="file"], [type="color"])';

function readMoment(): Moment {
  let overlayOpen = false;
  try {
    overlayOpen = document.querySelector("dialog[open], [popover]:popover-open") !== null;
  } catch {
    // No popovers (Safari before 17): only an open dialog counts there.
    overlayOpen = document.querySelector("dialog[open]") !== null;
  }
  const focused = document.activeElement;
  const editing =
    (focused instanceof HTMLElement &&
      (focused.isContentEditable || focused.matches(TEXT_FIELD))) ||
    [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TEXT_FIELD)].some(
      (field) => wasTypedIn(field) && field.value !== field.defaultValue,
    );
  return { playerState: document.documentElement.dataset.playerState, overlayOpen, editing };
}

/** True while this build has been loaded for fewer than APPLY_ATTEMPTS times in the tab; counts this one. False when the tab cannot remember. */
export function claimApply(build: string, store?: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    const kept = store ?? sessionStorage;
    // One count per build, so a claim for another build never resets this one's.
    const key = `${APPLIED_KEY}:${build}`;
    const tries = Number(kept.getItem(key)) || 0;
    if (tries >= APPLY_ATTEMPTS) return false;
    kept.setItem(key, String(tries + 1));
  } catch {
    // No per-tab marker survives a reload, so a stale edge copy could loop. Stop automatic reloads;
    // the next full navigation loads the current build.
    return false;
  }
  return true;
}

/**
 * Asks the site which build it serves. `pageBuild` is the build this bundle loaded with: the head's
 * meta is swapped by every move inside the app, so it is read once at load and passed in. Returns
 * the newer build's name, nothing when the page is current, and undefined when the question
 * could not be answered.
 */
async function newerBuild(pageBuild: string | undefined): Promise<string | null | undefined> {
  if (!navigator.onLine) return undefined;
  const response = await fetch("/build.json", { cache: "no-store" });
  if (!response.ok) return undefined;
  const siteBuild = ((await response.json()) as { build?: unknown }).build;
  if (!pageBuild || typeof siteBuild !== "string" || !siteBuild || siteBuild === pageBuild) {
    return null;
  }
  return siteBuild;
}

function watchForUpdates(registration: ServiceWorkerRegistration, pageBuild?: string): void {
  activateWhenIdle(registration);
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", () => activateWhenIdle(registration));
  });
  // The newer build, once known. The page loads it at the first safe moment: page loads go to the
  // network first, so the reload shows the new build under either worker, and a new worker, if the
  // deploy has one, takes over at the next idle moment.
  let newer: string | undefined;
  let retry: ReturnType<typeof setInterval> | undefined;
  const applyBuild = (): void => {
    if (!newer || !navigator.onLine || !canReloadNow(readMoment())) return;
    if (!claimApply(newer)) return;
    registration.update().catch(() => {});
    location.reload();
  };
  // Try again whenever the page is hidden, so an update that waited out a long listen still lands.
  let lastCheck = Date.now();
  let lastBuildCheck = 0;
  const askBuild = (): void => {
    if (Date.now() - lastBuildCheck < BUILD_CHECK_MS) return;
    lastBuildCheck = Date.now();
    // A check that could not answer (offline, a failed read) does not count against the minute:
    // the next return asks again.
    newerBuild(pageBuild).then(
      (answer) => {
        if (answer === undefined) {
          lastBuildCheck = 0;
          return;
        }
        newer = answer ?? undefined;
        if (!newer) {
          clearInterval(retry);
          retry = undefined;
          return;
        }
        applyBuild();
        // Waiting for a listen to end, a sheet to close or typing to stop.
        retry ??= setInterval(applyBuild, APPLY_RETRY_MS);
      },
      () => {
        lastBuildCheck = 0;
      },
    );
  };
  askBuild();
  // A page left open in front is asked now and then; a hidden one is asked when it comes back.
  setInterval(() => {
    if (!document.hidden) askBuild();
  }, BUILD_POLL_MS);
  // A move inside the app is the reader's own act: a stale bundle that is still here loads the
  // current one as soon as the new page is on screen.
  document.addEventListener("astro:page-load", applyBuild);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      activateWhenIdle(registration);
      applyBuild();
      return;
    }
    askBuild();
    if (shouldCheckForUpdate(Date.now(), lastCheck)) {
      lastCheck = Date.now();
      registration.update().catch(() => {
        // Offline: the next visit asks again.
      });
    }
  });
}

/** `pageBuild` is the build the page loaded with (the head meta, read before any move swaps it). */
export function registerServiceWorker(pageBuild?: string): void {
  // Development serves unhashed modules that a cache would keep stale.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = (): void => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => watchForUpdates(registration, pageBuild))
      .catch(() => {
        // Offline support is an enhancement. Reading works without it.
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
