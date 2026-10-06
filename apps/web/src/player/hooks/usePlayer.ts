import { useEffect, useRef, useSyncExternalStore } from "react";
import { getPlayerStore } from "../core/playerRuntime";
import { INITIAL_PLAYER_STATE } from "../core/playerStore";
import type { FrameListener, PlayerState } from "../core/playerTypes";

function subscribe(onChange: () => void): () => void {
  return getPlayerStore().subscribe(() => onChange());
}

function getState(): PlayerState {
  return getPlayerStore().getState();
}

function getServerState(): PlayerState {
  return INITIAL_PLAYER_STATE;
}

/** Coarse player state. The snapshot keeps its identity until status, item, rate or scrubbing change. */
export function usePlayerState(): PlayerState {
  return useSyncExternalStore(subscribe, getState, getServerState);
}

function subscribeSecond(onChange: () => void): () => void {
  return getPlayerStore().onSecond(onChange);
}

function getSecond(): number {
  return Math.floor(getPlayerStore().getTime());
}

/** The playhead in whole seconds: re-renders once a second while playing and on every seek. */
export function usePlayerSecond(): number {
  return useSyncExternalStore(subscribeSecond, getSecond, () => 0);
}

/**
 * Subscribes to the per-frame playhead without ever re-rendering. The callback writes to leaf
 * elements through refs. The latest callback is always the one called.
 */
export function usePlayerFrame(callback: FrameListener): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const store = getPlayerStore();
    const off = store.onFrame((time, duration) => latest.current(time, duration));
    // Paint once now, so a mount while paused shows the right position.
    latest.current(store.getTime(), store.getState().duration);
    return off;
  }, []);
}
