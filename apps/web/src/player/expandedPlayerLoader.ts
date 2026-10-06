import type { ComponentType } from "react";

/**
 * The expanded player is a separate chunk: Base UI's Drawer and the scrubber are not needed to read
 * or to press play. The chunk is fetched when the browser is idle, and again, harmlessly, at the
 * first touch on the mini player, so opening it never waits on the network.
 *
 * Once loaded the component lives here, outside React, so a swipe can mount the sheet in the same
 * event that starts it. React.lazy cannot do that: it suspends on its first render even when its
 * module is cached.
 */
let loaded: ComponentType | null = null;
let pending: Promise<ComponentType> | null = null;
const listeners = new Set<() => void>();

export function loadExpandedPlayer(): Promise<ComponentType> {
  pending ??= import("./ExpandedPlayer").then((module) => {
    loaded = module.default;
    for (const listener of listeners) listener();
    return module.default;
  });
  return pending;
}

export function getExpandedPlayer(): ComponentType | null {
  return loaded;
}

export function subscribeExpandedPlayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
