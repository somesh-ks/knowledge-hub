/**
 * A press on the play button over a cover. Loaded when the first one happens, so none of it weighs
 * on a page that is only read. It plays or pauses its item in place, or goes to the item's page and
 * starts it there.
 */
import { navigateTo } from "./navigation";
import { openPlayerOnPhone } from "./openOnPhone";
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
    const { status, digestId: loaded } = store.getState();
    const pausing = loaded === id && (status === "playing" || status === "loading");
    if (page.audio) togglePageDigest(store);
    else onNarrate?.();
    if (!pausing) openPlayerOnPhone();
    return;
  }
  const { digestId, status: now } = store.getState();
  if (digestId === id && now !== "idle") {
    if (now === "playing" || now === "loading") store.pause("user");
    else {
      store.play("user");
      openPlayerOnPhone();
    }
    return;
  }
  if (!href) return;
  expectPage(id);
  store.playWhenPageLoads(id);
  // The player opens once the page is there to play from, not over the page the press left.
  void navigateTo(href).then(openPlayerOnPhone);
}
