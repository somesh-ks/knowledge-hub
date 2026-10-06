/**
 * The expanded player is a separate chunk: Base UI's Drawer and the scrubber are not needed to read
 * or to press play. The chunk is fetched when the browser is idle and again, harmlessly, at the
 * first touch on the mini player, so opening it never waits on the network.
 */
export function loadExpandedPlayer() {
  return import("./ExpandedPlayer");
}
