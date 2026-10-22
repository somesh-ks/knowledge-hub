import type { PlayerTurn } from "../../types/contracts";

export interface TurnRange {
  from: number;
  to: number;
}

/**
 * The turns the open player shows as a transcript: those of the story being read, or, before story 1
 * (an episode's rundown), the opening turns that belong to no story. A turn with no story (a link
 * between stories, a sign-off) goes with the story before it. Null when there is nothing to show,
 * and every other story stays a chapter row.
 */
export function transcriptRange(
  turns: readonly Pick<PlayerTurn, "item_id">[],
  storyId: string | null,
): TurnRange | null {
  const owns = (turn: Pick<PlayerTurn, "item_id">): boolean =>
    storyId === null ? !turn.item_id : !turn.item_id || turn.item_id === storyId;
  const from =
    storyId === null
      ? turns.length > 0 && owns(turns[0] ?? {})
        ? 0
        : -1
      : turns.findIndex((turn) => turn.item_id === storyId);
  if (from < 0) return null;
  let to = from + 1;
  while (to < turns.length && owns(turns[to] ?? {})) to += 1;
  return { from, to };
}
