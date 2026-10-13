import type { PlayerItem, PlayerTurn } from "../../types/contracts";

/**
 * Whether the host says words before this turn's own that the page does not show. A briefing's
 * story is narrated with the section bridge or the link between stories ahead of it; an episode's
 * turn is its text and no more. Only a briefing's turns have a headline as their title.
 */
export function hasUnseenLeadIn(turn: PlayerTurn): boolean {
  return turn.title !== undefined;
}

/**
 * A briefing's transcript: one turn for each story, its headline over the words the host says, with
 * the times the narration has laid it out at (null until it has). The transcript view that reads an
 * episode's script reads these too, so a briefing and an episode have the same two views. A story
 * with no text is left out.
 */
export function storyTurns(items: readonly PlayerItem[]): PlayerTurn[] {
  return items.flatMap((item) =>
    item.text
      ? [
          {
            key: item.id,
            speaker: "a" as const,
            text: item.text,
            title: item.headline,
            item_id: item.id,
            start_ms: item.start_ms,
            end_ms: item.end_ms,
          },
        ]
      : [],
  );
}
