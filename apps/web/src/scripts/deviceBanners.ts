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
  hide("stale");
  const latest = document.querySelector<HTMLElement>('main[data-latest="true"]');
  const date = latest?.dataset.digestDate;
  if (!date) return;
  const age = staleAge(date, todayInStockholm());
  if (age !== null) show("stale", staleTitle(age));
}

export function installDeviceBanners(): void {
  document.addEventListener("astro:page-load", () => {
    syncConnection();
    syncStale();
  });
  window.addEventListener("online", syncConnection);
  window.addEventListener("offline", syncConnection);
}
