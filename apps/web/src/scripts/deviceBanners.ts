/**
 * The strips that depend on the device rather than on the build: offline, and for a moment back
 * online. Each is a Banner strip in the stack above the app (shell.css), which squeezes the page down
 * while it shows. Its markup is cloned from a <template> in the layout, so it has one home. Everything
 * here is progressive: without script the page reads the same, minus the strip.
 */

function bannerStack(): HTMLElement | null {
  return document.getElementById("banners");
}

type Kind = "offline" | "online";

/** The most the strip's close takes, in case its transition never ends (a hidden tab). */
const CLOSE_MS = 600;
let closeTimer: number | undefined;

/**
 * Opens the strip with one kind in it. An open strip keeps its height and swaps what it says (offline
 * to back online is one band, not two). A strip drawn again after a navigation passes `still`: it
 * is already open, so it stays put and plays nothing.
 */
function show(kind: Kind, still = false): void {
  const stack = bannerStack();
  const template = document.querySelector<HTMLTemplateElement>(`#banner-${kind}`);
  const source = template?.content.firstElementChild;
  if (!stack || !source || stack.querySelector(`[data-banner="${kind}"]`)) return;
  window.clearTimeout(closeTimer);
  const banner = source.cloneNode(true) as HTMLElement;
  banner.dataset.banner = kind;
  if (still) banner.dataset.still = "";
  stack.replaceChildren(banner);
  document.documentElement.setAttribute("data-strip", "");
}

/**
 * Closes the strip. The page rises as it goes and the band leaves the way it came (shell.css), so its
 * contents stay until it is gone.
 */
function hide(): void {
  const stack = bannerStack();
  document.documentElement.removeAttribute("data-strip");
  if (!stack?.firstElementChild) return;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => stack.replaceChildren(), CLOSE_MS);
}

/** The banner's title says why (BaseLayout.astro); a disabled control points at it. */
const OFFLINE_REASON = "offline-reason";

/**
 * New episode needs the network from its first step, so offline every Create control is disabled
 * (aria-disabled, so it stays focusable and says why it does nothing) and opens no sheet. So is
 * the other action that starts a run from a page, a new briefing; an episode's Regenerate and Delete
 * follow the connection themselves (episodeActionsEntry.ts), since they also wait on a run.
 */
function syncCreate(isOffline: boolean): void {
  const starters = "[data-create-open], [data-open='generate']";
  for (const create of document.querySelectorAll<HTMLElement>(starters)) {
    if (isOffline) {
      create.setAttribute("aria-disabled", "true");
      create.setAttribute("aria-describedby", OFFLINE_REASON);
    } else {
      create.removeAttribute("aria-disabled");
      if (create.getAttribute("aria-describedby") === OFFLINE_REASON) {
        create.removeAttribute("aria-describedby");
      }
    }
  }
}

/** How long "Back online" stays before the strip closes. */
const BACK_ONLINE_MS = 2500;
let backOnlineTimer: number | undefined;
let wasOffline = false;

/** The play chips disable themselves offline (the player's readerSync); this only says why. */
function syncConnection(event?: Event): void {
  const isOffline = !navigator.onLine;
  document.documentElement.toggleAttribute("data-offline", isOffline);
  syncCreate(isOffline);
  const quiet = document.documentElement.dataset.deviceBanner === "off";
  // A swap to another page left the new one with no strip: offline it comes back as it was, at once.
  const swapped = event?.type === "astro:after-swap";
  window.clearTimeout(backOnlineTimer);
  if (isOffline) {
    if (!quiet) show("offline", swapped);
  } else if (swapped) {
    // Back online ends with the page it was shown on.
    hide();
  } else if (wasOffline && !quiet) {
    // Only the moment the connection returns says so, not a page opened while online.
    show("online");
    backOnlineTimer = window.setTimeout(hide, BACK_ONLINE_MS);
  } else hide();
  wasOffline = isOffline;
}

export function installDeviceBanners(): void {
  // A strip goes in before the page it belongs to shows, so the page is never pushed down after it
  // has drawn: on a first load the inline script has put it in (bannersInit.js) and this only
  // checks; on a navigation this runs right after the swap, before the new page is shown.
  syncConnection();
  document.addEventListener("astro:after-swap", syncConnection);
  window.addEventListener("online", syncConnection);
  window.addEventListener("offline", syncConnection);
}
