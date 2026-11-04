import { playerSheet } from "./playerSheet";

/** Below this width the player is a sheet over the page; from it, a bar that never opens by itself. */
const PHONE = "(width < 64rem)";

/**
 * A press on Play, wherever it is (a cover, the queue, a page's chip), starts the podcast in the player:
 * on a phone the player opens over the page, on a desktop the bar only changes to playing and stays shut
 * (owner, 2026-11-02). Only a press does this; autoplay into the next item never opens anything.
 */
export function openPlayerOnPhone(): void {
  if (window.matchMedia(PHONE).matches) void playerSheet.expand();
}
