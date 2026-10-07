/**
 * What a tap on the reader page means to the player. The page shows one digest; the player may be
 * holding another. Every action first makes sure the page's digest is the loaded track, so a tap
 * on today's play button never resumes yesterday's narration.
 */

import type { PlayerStore } from "./playerTypes";
import { findItemIndexById } from "./timeline";

/** Loads the page's digest into the audio element when another one is loaded. Returns false if the page has no audio. */
export function ensurePageTrack(store: PlayerStore): boolean {
  const page = store.getPageDigest();
  if (!page?.audio) return false;
  if (store.getState().digestId !== page.id) store.load(page);
  return true;
}

/** The briefing's chip: play, pause, resume, play again, or retry, depending on where playback is. */
export function togglePageDigest(store: PlayerStore): void {
  if (!ensurePageTrack(store)) return;
  const { status } = store.getState();
  if (status === "playing" || status === "loading") store.pause("user");
  else store.play("user");
}

/**
 * An item's play button. Tapping the item that is playing pauses it; tapping the item that is
 * paused resumes where it stopped; anything else starts it from its beginning.
 */
export function togglePageItem(store: PlayerStore, itemId: string): void {
  if (!ensurePageTrack(store)) return;
  const state = store.getState();
  const index = findItemIndexById(state.track?.timeline ?? null, itemId);
  if (index < 0) return;
  const isCurrent =
    state.itemIndex === index && state.status !== "idle" && state.status !== "ended";
  if (isCurrent && (state.status === "playing" || state.status === "loading")) {
    store.pause("user");
    return;
  }
  if (isCurrent && state.status === "paused") {
    store.play("user");
    return;
  }
  store.playItemAt(index);
}

/** A chapter control plays its section from the top. */
export function playPageChapter(store: PlayerStore, firstItemId: string): void {
  if (!ensurePageTrack(store)) return;
  store.playItem(firstItemId);
}
