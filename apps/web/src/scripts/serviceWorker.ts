/**
 * Registers the service worker after the page has loaded, so it never competes with first paint.
 * An update installs in the background and activates only while nothing is playing, so a new
 * version can never cut off narration. The page is not reloaded either: the next navigation simply
 * uses the new worker's caches. A page from an older deploy offers the current one in a toast, on
 * load and when the app comes back to the front; only the reader's Reload loads it (checkBuild).
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
/** The build this session was last offered, so a dismissed prompt does not come back for it. */
const OFFERED = "dispatch:build-offered";
/** The toast's event and its ready signal (sheets/toastStore.ts), spelled out: no store import. */
const TOAST_EVENT = "dispatch:toast";
const TOAST_READY = "dispatch:toast-ready";
let offeredHere: string | null = null;

function readOffered(): string | null {
  try {
    return sessionStorage.getItem(OFFERED) ?? offeredHere;
  } catch {
    return offeredHere;
  }
}

function markOffered(build: string): void {
  offeredHere = build;
  try {
    sessionStorage.setItem(OFFERED, build);
  } catch {
    // Storage blocked: the page's own memory keeps it to once per page.
  }
}

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
 * Hands the toast its content. The toast's store loads with the sheets at idle and takes the event
 * by cancelling it; before it has loaded, the content waits for the store's ready signal.
 */
function toast(detail: object): void {
  const send = (): boolean =>
    !document.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail, cancelable: true }));
  if (!send()) document.addEventListener(TOAST_READY, () => send(), { once: true });
}

/**
 * Asks the site which build it serves and, when the page on screen is older, offers the current one
 * with a Reload. It never reloads by itself: the reader may be typing, listening or holding an Undo.
 * Offered once per build per session; the answer is `true` when the offer waits for a toast that
 * is up, so the next return asks again.
 */
async function checkBuild(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (!navigator.onLine) return false;
  const pageBuild =
    document.querySelector<HTMLMetaElement>('meta[name="dispatch-build"]')?.content || undefined;
  const response = await fetch("/build.json", { cache: "no-store" });
  if (!response.ok) return false;
  const siteBuild = ((await response.json()) as { build?: unknown }).build;
  if (!pageBuild || typeof siteBuild !== "string" || !siteBuild || siteBuild === pageBuild) {
    return false;
  }
  if (siteBuild === readOffered()) return false;
  if (toastIsUp()) return true;
  markOffered(siteBuild);
  toast({
    message: "New version available",
    actionLabel: "Reload",
    onAction: () => {
      // The deploy may carry a new worker too. The reload's page load goes to the network either way.
      void registration
        .update()
        .catch(() => {})
        .then(() => location.reload());
    },
  });
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
  const askBuild = (): void => {
    if (Date.now() - lastBuildCheck < BUILD_CHECK_MS) return;
    lastBuildCheck = Date.now();
    checkBuild(registration)
      .then((deferred) => {
        // An offer that waited for another toast is made on the next return, not after the wait.
        if (deferred) lastBuildCheck = 0;
      })
      .catch(() => {
        // Offline or a failed read: the page on screen stays, and the next return asks again.
      });
  };
  // On load as well, outside the once-a-minute limit, which is for returns to the front.
  checkBuild(registration).catch(() => {});
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
