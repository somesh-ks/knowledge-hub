import type { PlayerTurn } from "../../types/contracts";

/**
 * The turn being spoken at `seconds`, or -1 before the first or when the turns have no times yet.
 * Turns are in playing order, so a turn without a span is skipped and the last one that has begun
 * stays current until the next begins.
 */
export function currentTurnIndex(turns: readonly PlayerTurn[], seconds: number): number {
  const ms = seconds * 1000;
  let found = -1;
  for (let index = 0; index < turns.length; index += 1) {
    const start = turns[index]?.start_ms;
    if (start === null || start === undefined) continue;
    if (start <= ms) found = index;
    else break;
  }
  return found;
}

/** How long a manual scroll keeps the script from following the voice. */
export const FOLLOW_PAUSE_MS = 4000;
