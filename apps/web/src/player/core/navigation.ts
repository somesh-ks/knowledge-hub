import { dateFromDigestId } from "./formatTime";

export type NavigationDirection = "forward" | "back";

export function digestUrl(digestId: string): string {
  return `/d/${digestId}`;
}

/**
 * Which way a move between two briefings points in time. A newer briefing is forward, an older one
 * is back, so a page transition can slide the right way and "Up next" (the previous briefing)
 * always reads as going back.
 */
export function directionBetween(currentId: string | null, targetId: string): NavigationDirection {
  const current = currentId ? dateFromDigestId(currentId) : null;
  const target = dateFromDigestId(targetId);
  if (!current || !target) return "forward";
  const delta = target.getTime() - current.getTime();
  if (delta !== 0) return delta > 0 ? "forward" : "back";
  // Same day: ids differ by suffix ("-weekly", "-2"); a longer id came later.
  return targetId > (currentId ?? "") ? "forward" : "back";
}

export interface NavigateOptions {
  direction?: NavigationDirection;
  /** "replace" puts the page in the current history entry instead of a new one. */
  history?: "push" | "replace";
}

/**
 * Client-side navigation through Astro's ClientRouter when it is on the page, otherwise a normal
 * load. The direction travels in `info`, where the layout's transition code can read it from the
 * navigation events.
 */
export async function navigateTo(url: string, options: NavigateOptions = {}): Promise<void> {
  try {
    const { navigate } = await import("astro:transitions/client");
    await navigate(url, {
      history: options.history ?? "auto",
      info: { direction: options.direction ?? "forward" },
    });
  } catch {
    if (options.history === "replace") window.location.replace(url);
    else window.location.assign(url);
  }
}
