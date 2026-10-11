/**
 * Which floating button a page shows below 64rem, if any (BaseLayout.astro renders it). From 64rem
 * the side column carries Create on every page and no floating button is shown.
 */
export type FabKind = "create" | "play";

export interface FabPage {
  /** The page's path without a trailing slash, "/" for the root. */
  path: string;
  /** The page has audio of its own to play: Today, a briefing or an episode. */
  playable: boolean;
}

/**
 * Create on the Library alone, the list where making an episode is the next thing to do (D60). Play
 * on every page with audio of its own, Today included, where hearing it is the next thing to do.
 * Settings, Create itself, offline, not found and a Today with no briefing yet have none.
 */
export function fabFor({ path, playable }: FabPage): FabKind | null {
  if (path === "/library") return "create";
  return playable ? "play" : null;
}
