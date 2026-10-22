import { describe, expect, it } from "vitest";
import { countListening } from "./listenEvents";
import type { PlayerEvent, PlayerState } from "./playerTypes";

function fakeStore() {
  let state = { status: "idle", duration: 600, track: null } as unknown as PlayerState;
  let time = 0;
  const stateListeners = new Set<(s: PlayerState, p: PlayerState) => void>();
  const secondListeners = new Set<() => void>();
  const eventListeners = new Set<(e: PlayerEvent) => void>();
  return {
    getState: () => state,
    getTime: () => time,
    subscribe: (l: (s: PlayerState, p: PlayerState) => void) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    onSecond: (l: () => void) => {
      secondListeners.add(l);
      return () => secondListeners.delete(l);
    },
    onEvent: (l: (e: PlayerEvent) => void) => {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
    set(id: string, status: PlayerState["status"], at = time): void {
      const previous = state;
      time = at;
      state = { ...state, status, track: { digest: { id, kind: "regular" } } } as PlayerState;
      for (const l of stateListeners) l(state, previous);
      for (const l of secondListeners) l();
    },
    end(): void {
      for (const l of eventListeners) l({ type: "ended" });
    },
  };
}

describe("countListening", () => {
  // Pause and resume, a seek back past the middle and a replay each counted the same listen again,
  // so starts and completions overstated how much was heard.
  it("counts each milestone once per item, however often it plays", () => {
    const store = fakeStore();
    const counted: string[] = [];
    countListening(store, (name, metadata) => counted.push(`${name}:${metadata?.kind}`));
    store.set("a", "playing", 0);
    store.set("a", "paused", 120);
    store.set("a", "playing", 120);
    store.set("a", "paused", 299);
    store.set("a", "playing", 301);
    store.set("a", "playing", 100);
    store.set("a", "playing", 400);
    store.end();
    store.set("a", "playing", 0);
    store.end();
    store.set("b", "playing", 0);
    expect(counted).toEqual([
      "listen_start:regular",
      "listen_half:regular",
      "listen_complete:regular",
      "listen_start:regular",
    ]);
  });
});
