import type { Episode } from "./episodeFile";
import { sourceHost } from "./sourceLabel";

/**
 * The highlights of an episode: one entry per story it covers, in the order the hosts reach them,
 * each with a few plain sentences and the link. A story that is in a briefing gets that briefing's
 * summary. Otherwise the sentences come from the script: the first turn about the story that says
 * something beyond its headline, without the hosts' segues ("Start with emphasis.", "Next, ..."),
 * their questions ("What does that enable?") and any sentence that only repeats the headline,
 * trimmed at a sentence end.
 */

export interface Highlight {
  itemId: string;
  headline: string;
  /** What was said about it. Empty when the script never reaches the story. */
  text: string;
  url: string;
  /** "theverge.com", or null where the address must not become a link. */
  host: string | null;
  /** The attribution under the text: the publisher, or the host for an aggregator. */
  publisher: string | null;
}

/** An aggregator's name ("Exa discovery") says nothing about where a story is from. */
const AGGREGATOR = /discovery|hacker news|lobsters|product hunt/i;

/** The publisher to show for a story: its name, or its host where the name is an aggregator's. */
export function publisherOf(source: string, host: string | null): string | null {
  return AGGREGATOR.test(source) || !source.trim() ? host : source;
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

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** A sentence that mostly says the headline again, such as "Today's top story: <headline>." */
function repeatsHeadline(sentence: string, headline: Set<string>): boolean {
  const own = words(sentence);
  if (own.length === 0) return true;
  const shared = own.filter((word) => headline.has(word)).length;
  return shared / own.length >= 0.6;
}

/** A host's lead-in before a story: "Today's top story:", "Next,", "Now,". */
const LEAD_IN =
  /^(?:(?:today's |our )?top story|next(?: up)?|now|finally|and finally|also|first|in other news)\s*[:,]\s*/i;

/** What a turn says about a story, without segues and without the headline said again. */
export function spokenSummary(text: string, headline: string): string {
  const heading = new Set(words(headline));
  // A sentence ends at a stop followed by a space, so "0.1.3" or "DESIGN.md" stays whole.
  const sentences = clean(text).split(/(?<=[.!?])\s+/);
  const kept = sentences
    .map((sentence) => {
      const bare = sentence.replace(LEAD_IN, "").trim();
      return bare === sentence.trim() ? bare : bare.charAt(0).toUpperCase() + bare.slice(1);
    })
    .filter((sentence, index) => {
      if (!sentence) return false;
      // A host's question ("What does that enable?") says nothing yet: the answer is the highlight.
      if (/\?["')\]]*$/.test(sentence)) return false;
      // A segue that opens the turn: "Start with emphasis.", "Now latency."
      if (index === 0 && words(sentence).length <= 3 && sentences.length > 1) return false;
      return !repeatsHeadline(sentence, heading);
    });
  return kept.join(" ");
}

export function episodeHighlights(
  episode: Pick<Episode, "sources" | "turns">,
  /** Briefing summaries by item id, for the stories an episode shares with a briefing. */
  summaries: ReadonlyMap<string, string> = new Map(),
): Highlight[] {
  const said = new Map<string, string>();
  const order: string[] = [];
  const headlines = new Map(episode.sources.map((source) => [source.item_id, source.headline]));
  for (const turn of episode.turns) {
    if (!turn.item_id) continue;
    if (!order.includes(turn.item_id)) order.push(turn.item_id);
    if (said.has(turn.item_id)) continue;
    const text = spokenSummary(turn.text, headlines.get(turn.item_id) ?? "");
    if (text) said.set(turn.item_id, text);
  }
  const rank = (id: string): number => {
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  return episode.sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => rank(a.source.item_id) - rank(b.source.item_id) || a.index - b.index)
    .map(({ source }) => {
      const host = sourceHost(source.url);
      return {
        itemId: source.item_id,
        headline: source.headline,
        text: trimAtSentence(summaries.get(source.item_id) ?? said.get(source.item_id) ?? ""),
        url: source.url,
        host,
        publisher: host ? publisherOf(source.source, host) : null,
      };
    });
}
