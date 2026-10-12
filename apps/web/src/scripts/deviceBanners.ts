/**
 * The banner that depends on the device rather than on the build: offline. Its markup is cloned from
 * a <template> in the layout, so it has one home. Everything here is progressive: without script
 * the page reads the same, minus the banner.
 */

function bannerStack(): HTMLElement | null {
  return document.getElementById("banners");
}

function show(kind: "offline"): void {
  const stack = bannerStack();
  const template = document.querySelector<HTMLTemplateElement>(`#banner-${kind}`);
  const source = template?.content.firstElementChild;
  if (!stack || !source || stack.querySelector(`[data-banner="${kind}"]`)) return;
  const banner = source.cloneNode(true) as HTMLElement;
  banner.dataset.banner = kind;
  stack.prepend(banner);
}

function hide(kind: "offline"): void {
  bannerStack()?.querySelector(`[data-banner="${kind}"]`)?.remove();
}

/**
 * New episode needs the network from its first step, so offline every Create control is disabled
 * (aria-disabled, so it stays focusable and says why it does nothing) and opens no sheet. So is
 * every other action that starts a run: a new briefing, and an episode's Regenerate and Delete.
 */
function syncCreate(isOffline: boolean): void {
  const starters = "[data-create-open], [data-open='generate'], [data-episode-action]";
  for (const create of document.querySelectorAll<HTMLElement>(starters)) {
    if (isOffline) create.setAttribute("aria-disabled", "true");
    else create.removeAttribute("aria-disabled");
  }
}

/** The play chips disable themselves offline (the player's readerSync); this only says why. */
function syncConnection(): void {
  const isOffline = !navigator.onLine;
  document.documentElement.toggleAttribute("data-offline", isOffline);
  syncCreate(isOffline);
  if (isOffline && document.documentElement.dataset.deviceBanner !== "off") show("offline");
  else hide("offline");
}

export function installDeviceBanners(): void {
  // A banner goes in before the page it belongs to shows, so it never pushes the page down after it
  // has drawn: on a first load the inline script has put it in (bannersInit.js) and this only
  // checks; on a navigation this runs right after the swap, before the new page is shown.
  syncConnection();
  document.addEventListener("astro:after-swap", syncConnection);
  window.addEventListener("online", syncConnection);
  window.addEventListener("offline", syncConnection);
}
