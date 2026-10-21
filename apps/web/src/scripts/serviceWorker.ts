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

/** Asks the site which build it serves and loads it when the page on screen is older. */
async function checkBuild(registration: ServiceWorkerRegistration): Promise<void> {
  if (!navigator.onLine) return;
  const pageBuild =
    document.querySelector<HTMLMetaElement>('meta[name="dispatch-build"]')?.content || undefined;
  const response = await fetch("/build.json", { cache: "no-store" });
  if (!response.ok) return;
  const siteBuild = ((await response.json()) as { build?: unknown }).build;
  let reloadedFor: string | null = null;
  try {
    reloadedFor = sessionStorage.getItem(RELOADED_FOR);
  } catch {
    // Storage blocked: no reload, since nothing would stop a second one.
    return;
  }
  const playerState = document.documentElement.dataset.playerState;
  if (!shouldReloadForBuild(pageBuild, siteBuild, playerState, reloadedFor)) return;
  sessionStorage.setItem(RELOADED_FOR, String(siteBuild));
  // The deploy may carry a new worker too. The reload's page load goes to the network either way.
  await registration.update().catch(() => {});
  location.reload();
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
      checkBuild(registration).catch(() => {
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
