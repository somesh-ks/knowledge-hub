/**
 * Which floating button a page shows below 64rem, if any (BaseLayout.astro renders it). From 64rem
 * the side column carries Create on every page and no floating button is shown.
 */
export type FabKind = "create" | "play";

export interface FabPage {
  /** The navigation marks the page as Today: Today itself, or the latest briefing at its address. */
  today: boolean;
  /** The page's path without a trailing slash, "/" for the root. */
  path: string;
  /** The page has audio of its own to play: an episode or a briefing. */
  playable: boolean;
}

/**
 * Create on the two lists where making an episode is the next thing to do, Today and the Library
 * (D52). Play on an episode or an older briefing, where hearing the page is the next thing to do.
 * Settings, Create itself, offline and not found have none.
 */
export function fabFor({ today, path, playable }: FabPage): FabKind | null {
  if (today || path === "/library") return "create";
  return playable ? "play" : null;
}
