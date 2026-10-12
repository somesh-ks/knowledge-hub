import { getPlayerStore, playPageStory } from "../core/playerRuntime";
import { steppedStory, storyEntries } from "../core/storyEntries";
import { usePlayerState } from "./usePlayer";

export interface StoryStep {
  previousDisabled: boolean;
  nextDisabled: boolean;
  previous(): void;
  next(): void;
}

/**
 * Previous story and Next story, for the page's transport and the bar's. On a timeline the store
 * steps between its stories; an episode not laid out yet steps between the story starts its script
 * gives, and starts narrating there.
 */
export function useStoryStep(): StoryStep {
  const state = usePlayerState();
  const store = getPlayerStore();
  const timeline = state.track?.timeline ?? null;
  const digest = state.track?.digest;
  const itemCount = timeline?.items.length ?? 0;
  if (itemCount > 0 || !digest) {
    const atLast = itemCount === 0 || state.itemIndex >= itemCount - 1;
    return {
      previousDisabled: itemCount === 0,
      nextDisabled: atLast,
      previous: () => {
        store.previous();
      },
      next: () => {
        if (!atLast) store.next();
      },
    };
  }
  const { items } = storyEntries(timeline, digest);
  const at = store.getTime();
  const before = steppedStory(items, at, -1);
  const after = steppedStory(items, at, 1);
  return {
    previousDisabled: before === null,
    nextDisabled: after === null,
    previous: () => {
      if (before) playPageStory(digest.id, before.id);
    },
    next: () => {
      if (after) playPageStory(digest.id, after.id);
    },
  };
}
