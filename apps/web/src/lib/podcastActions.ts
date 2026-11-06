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
  "delete",
] as const;

export type PodcastAction = (typeof PODCAST_ACTIONS)[number];

/** Puts a sheet's actions in the one order. */
export const inPodcastOrder = (actions: readonly PodcastAction[]): PodcastAction[] =>
  PODCAST_ACTIONS.filter((action) => actions.includes(action));
