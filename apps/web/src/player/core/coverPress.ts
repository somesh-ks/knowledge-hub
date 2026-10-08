/**
 * A press on the play button over a cover. Loaded when the first one happens, so none of it weighs
 * on a page that is only read. It plays or pauses its item in place, or goes to the item's page and
 * starts it there.
 */
import { navigateTo } from "./navigation";
import { togglePageDigest } from "./pageActions";
import type { PlayerStore } from "./playerTypes";

export interface CoverPress {
  store: PlayerStore;
  /** Narrates the page's briefing, for one with no audio yet. */
  onNarrate?: () => void;
  /** Remembers the id of a briefing the press is taking the listener to. */
  expectPage(id: string): void;
  id: string;
  href: string | undefined;
}

export function pressCover({ store, onNarrate, expectPage, id, href }: CoverPress): void {
  const page = store.getPageDigest();
  if (page?.id === id) {
    if (page.audio) togglePageDigest(store);
    else onNarrate?.();
    return;
  }
  const { digestId, status } = store.getState();
  if (digestId === id && status !== "idle") {
    if (status === "playing" || status === "loading") store.pause("user");
    else store.play("user");
    return;
  }
  if (!href) return;
  expectPage(id);
  store.playWhenPageLoads(id);
  void navigateTo(href);
}
