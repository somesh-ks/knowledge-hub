import type { PlayerItem, PlayerTurn } from "../../types/contracts";

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
            ...(item.lead_words ? { lead_words: item.lead_words } : {}),
            item_id: item.id,
            start_ms: item.start_ms,
            end_ms: item.end_ms,
          },
        ]
      : [],
  );
}
