import type { Episode } from "./episodeFile";
import { sourceHost } from "./sourceLabel";

/**
 * The highlights of an episode: one entry per story it covers, in the order the hosts reach them,
 * each with a few plain sentences of what was said and the link. Episodes store no summary per
 * story yet, so the sentences come from the script itself: the first turns that carry the story's
 * id, trimmed at a sentence end.
 */

export interface Highlight {
  itemId: string;
  headline: string;
  /** What was said about it. Empty when the script never reaches the story. */
  text: string;
  url: string;
  /** "theverge.com", or null where the address must not become a link. */
  host: string | null;
}

/** About how long the sentences run before they are cut at a sentence end. */
export const HIGHLIGHT_CHARS = 240;
/** A speaker label ("Host:", "Guest:") that a script line may open with. */
const SPEAKER_LABEL = /^\s*(?:host|guest|speaker\s*[ab12]|[ab])\s*:\s*/i;

const clean = (text: string): string => text.replace(SPEAKER_LABEL, "").replace(/\s+/g, " ").trim();

/** `text` cut to about `limit` characters, at the last sentence end that fits. */
export function trimAtSentence(text: string, limit = HIGHLIGHT_CHARS): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit + 1);
  let end = -1;
  for (const match of head.matchAll(/[.!?](?=\s|$)/g)) end = match.index ?? end;
  if (end > 0) return head.slice(0, end + 1);
  // One long sentence: stop at a word, and say it goes on.
  const word = head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : limit);
  return `${word.replace(/[,;:\s]+$/, "")}…`;
}

export function episodeHighlights(episode: Pick<Episode, "sources" | "turns">): Highlight[] {
  const said = new Map<string, string[]>();
  const order: string[] = [];
  for (const turn of episode.turns) {
    if (!turn.item_id) continue;
    const lines = said.get(turn.item_id);
    const line = clean(turn.text);
    if (!line) continue;
    if (!lines) {
      said.set(turn.item_id, [line]);
      order.push(turn.item_id);
    } else if (lines.length < 2) {
      lines.push(line);
    }
  }
  const rank = (id: string): number => {
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  return episode.sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => rank(a.source.item_id) - rank(b.source.item_id) || a.index - b.index)
    .map(({ source }) => ({
      itemId: source.item_id,
      headline: source.headline,
      text: trimAtSentence((said.get(source.item_id) ?? []).join(" ")),
      url: source.url,
      host: sourceHost(source.url),
    }));
}
