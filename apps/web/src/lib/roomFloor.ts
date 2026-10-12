/** What can float over the bottom of the page: the bottom bar, the player, the run card, the buttons. */
export const FLOATING = ".app-nav, .player-dock, .run-card, .create-fab, .manage-bar";

/**
 * How far down the screen a list opening under `field` may reach: the top of the highest thing that
 * floats over the page below the field and across its width, or the bottom of the screen.
 */
export function roomFloor(field: DOMRect, covers: readonly DOMRect[], viewport: number): number {
  let floor = viewport;
  for (const cover of covers) {
    const across = cover.width > 0 && cover.left < field.right && cover.right > field.left;
    if (across && cover.top > field.bottom && cover.top < floor) floor = cover.top;
  }
  return floor;
}
