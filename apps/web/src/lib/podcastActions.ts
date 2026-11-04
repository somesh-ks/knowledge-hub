/**
 * Every podcast sheet lists its actions in this one order (D369): a Library card's hold and ⋮, a
 * podcast page's ⋮, Downloads, Favorites and a queue row. A sheet leaves out what does not apply
 * there; it never reorders. components/PodcastMenuItems.astro and player/QueueRowMenu.tsx draw from
 * it, and the browser suite checks each sheet against it (e2e/libraryMenu.spec.ts).
 */
export const PODCAST_ACTIONS = [
  "favorite",
  "queue",
  "share",
  "download",
  "regenerate",
  "podcast",
  "unshare",
  "delete",
] as const;

export type PodcastAction = (typeof PODCAST_ACTIONS)[number];

/** Puts a sheet's actions in the one order. */
export const inPodcastOrder = (actions: readonly PodcastAction[]): PodcastAction[] =>
  PODCAST_ACTIONS.filter((action) => actions.includes(action));

/**
 * A sheet shows its first three actions as tiles only when it has this many or more (owner,
 * 2026-11-04: a short sheet is a plain list).
 * shortcut: a local copy of the Menu's own threshold, until the design system's menu.ts exports it.
 */
export const TILES_MIN = 5;
export const TILE_COUNT = 3;
