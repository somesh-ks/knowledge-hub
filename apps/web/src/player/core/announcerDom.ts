import { type Announcer, createAnnouncer } from "./announcements";

let regions: [HTMLElement, HTMLElement] | null = null;

function createRegion(): HTMLElement {
  const region = document.createElement("div");
  region.className = "sr-only";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("data-announcer", "");
  document.body.appendChild(region);
  return region;
}

/**
 * Two live regions, created on first use and again whenever a navigation swapped the body away
 * from under them. They are imperative on purpose: any island, or none, can announce.
 */
function getRegions(): [HTMLElement, HTMLElement] {
  if (regions?.[0].isConnected && regions[1].isConnected) return regions;
  regions = [createRegion(), createRegion()];
  return regions;
}

const announcer: Announcer = createAnnouncer(getRegions);

export function announce(message: string): void {
  announcer.announce(message);
}
