/**
 * Registers the service worker after the page has loaded, so it never competes with first paint.
 * An update installs in the background and activates only while nothing is playing, so a new
 * version can never cut off narration. The page is not reloaded either: the next navigation simply
 * uses the new worker's caches.
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

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  activateWhenIdle(registration);
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", () => activateWhenIdle(registration));
  });
  // Try again whenever the page is hidden, so an update that waited out a long listen still lands.
  let lastCheck = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      activateWhenIdle(registration);
    } else if (shouldCheckForUpdate(Date.now(), lastCheck)) {
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
