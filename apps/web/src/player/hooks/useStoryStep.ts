import { useSyncExternalStore } from "react";
import { getPlayerStore, playPageStory } from "../core/playerRuntime";
import { steppedStory, storyEntries } from "../core/storyEntries";
import { usePlayerState } from "./usePlayer";

export interface StoryStep {
  previousDisabled: boolean;
  nextDisabled: boolean;
  previous(): void;
  next(): void;
}

function subscribeSecond(onChange: () => void): () => void {
  return getPlayerStore().onSecond(onChange);
}

/** The playhead is at 0:00. A boolean, so it re-renders only when that flips. */
function atStart(): boolean {
  return getPlayerStore().getTime() <= 0;
}

/**
 * Previous story and Next story, for the page's transport and the bar's. On a timeline the store
 * steps between its stories; an episode not laid out yet steps between the story starts its script
 * gives, and starts narrating there. Before the first story (an episode's rundown) Next goes to
 * story 1 and Previous to 0:00, where it has nowhere further to go.
 */
export function useStoryStep(): StoryStep {
  const state = usePlayerState();
  const store = getPlayerStore();
  const start = useSyncExternalStore(subscribeSecond, atStart, () => true);
  const timeline = state.track?.timeline ?? null;
  const digest = state.track?.digest;
  const itemCount = timeline?.items.length ?? 0;
  if (itemCount > 0 || !digest) {
    const atLast = itemCount === 0 || state.itemIndex >= itemCount - 1;
    return {
      previousDisabled: itemCount === 0 || (state.itemIndex < 0 && start),
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
