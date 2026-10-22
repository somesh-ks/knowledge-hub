/**
 * Registers the service worker after the page has loaded, so it never competes with first paint.
 * An update installs in the background and activates only while nothing is playing, so a new
 * version can never cut off narration. The page is not reloaded either: the next navigation simply
 * uses the new worker's caches. A page from an older deploy offers the current one in a toast, on
 * load and when the app comes back to the front; only the reader's Reload loads it (checkBuild).
 */

import { sendToast } from "./toastEvent";

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

/**
 * The site's build is asked for at most this often, on load and on each return to the front. It is
 * the only limit on the offer: a dismissed one comes back at the next check that finds it newer.
 */
const BUILD_CHECK_MS = 60 * 1000;
/** The longest a Reload waits for a new worker before it reloads anyway. */
const RELOAD_WAIT_MS = 1500;

/** A toast is up (an Undo waiting to be sent, a saved notice): a new one would replace it. */
function toastIsUp(): boolean {
  try {
    return document.querySelector(".toast:popover-open") !== null;
  } catch {
    // No popovers (Safari before 17): the toast is never shown there, so none is up.
    return false;
  }
}

/**
 * Asks the site which build it serves and, when the page on screen is older and no toast is up,
 * offers the current one with a Reload. It never reloads by itself: the reader may be typing,
 * listening or holding an Undo. Without the Popover API the toast cannot show, and nothing more is
 * done: the next navigation picks up the deploy, since page loads go to the network first.
 */
async function checkBuild(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (!navigator.onLine) return false;
  const pageBuild =
    document.querySelector<HTMLMetaElement>('meta[name="dispatch-build"]')?.content || undefined;
  const response = await fetch("/build.json", { cache: "no-store" });
  if (!response.ok) return false;
  const siteBuild = ((await response.json()) as { build?: unknown }).build;
  if (!pageBuild || typeof siteBuild !== "string" || !siteBuild || siteBuild === pageBuild) {
    return true;
  }
  // Another toast up (an Undo, a lost save) is left alone; the next return asks again.
  if (toastIsUp()) return false;
  sendToast(
    {
      message: "New version available",
      actionLabel: "Reload",
      // A new worker, when the deploy has one, installs first so it answers the reload; a slow
      // network never holds the reload more than a moment (the page load is network-first anyway).
      onAction: () => {
        Promise.race([
          registration.update().catch(() => {}),
          new Promise((settle) => setTimeout(settle, RELOAD_WAIT_MS)),
        ]).finally(() => location.reload());
      },
    },
    document,
    { key: "deploy", unless: toastIsUp },
  );
  return true;
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  activateWhenIdle(registration);
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", () => activateWhenIdle(registration));
  });
  // Try again whenever the page is hidden, so an update that waited out a long listen still lands.
  let lastCheck = Date.now();
  let lastBuildCheck = 0;
  const askBuild = (): void => {
    if (Date.now() - lastBuildCheck < BUILD_CHECK_MS) return;
    lastBuildCheck = Date.now();
    // A check that could not answer (offline, a failed read, another toast up) does not count
    // against the minute: the next return asks again.
    checkBuild(registration).then(
      (answered) => {
        if (!answered) lastBuildCheck = 0;
      },
      () => {
        lastBuildCheck = 0;
      },
    );
  };
  askBuild();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      activateWhenIdle(registration);
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

export function registerServiceWorker(): void {
  // Development serves unhashed modules that a cache would keep stale.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
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
