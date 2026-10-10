import { staleAge, staleTitle, todayInStockholm } from "../lib/staleness";

/**
 * Banners that depend on the device and the clock rather than on the build: offline, and a briefing
 * that has gone stale. Their markup is cloned from <template> elements in the layout, so it has one
 * home. Everything here is progressive: without script the page reads the same, minus the banner.
 */

function bannerStack(): HTMLElement | null {
  return document.getElementById("banners");
}

function show(kind: "offline" | "stale", title?: string): void {
  const stack = bannerStack();
  const template = document.querySelector<HTMLTemplateElement>(`#banner-${kind}`);
  const source = template?.content.firstElementChild;
  if (!stack || !source || stack.querySelector(`[data-banner="${kind}"]`)) return;
  const banner = source.cloneNode(true) as HTMLElement;
  banner.dataset.banner = kind;
  const heading = banner.querySelector(".banner-title");
  if (heading && title) heading.textContent = title;
  stack.prepend(banner);
}

function hide(kind: "offline" | "stale"): void {
  bannerStack()?.querySelector(`[data-banner="${kind}"]`)?.remove();
}

/** The play chips disable themselves offline (the player's readerSync); this only says why. */
function syncConnection(): void {
  const isOffline = !navigator.onLine;
  document.documentElement.toggleAttribute("data-offline", isOffline);
  if (isOffline) show("offline");
  else hide("offline");
}

function syncStale(): void {
  const latest = document.querySelector<HTMLElement>('main[data-latest="true"]');
  const date = latest?.dataset.digestDate;
  const age = date ? staleAge(date, todayInStockholm()) : null;
  // On a first load the inline script (bannersInit.js) has already put a stale banner in; it stays.
  if (age === null) hide("stale");
  else show("stale", staleTitle(age));
}

export function installDeviceBanners(): void {
  // A banner goes in before the page it belongs to shows, so it never pushes the page down after it
  // has drawn: on a first load the inline script has put it in (bannersInit.js) and this only
  // checks; on a navigation this runs right after the swap, before the new page is shown.
  const sync = (): void => {
    syncConnection();
    syncStale();
  };
  sync();
  document.addEventListener("astro:after-swap", sync);
  window.addEventListener("online", syncConnection);
  window.addEventListener("offline", syncConnection);
}
