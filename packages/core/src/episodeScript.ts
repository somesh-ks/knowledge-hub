import { parse } from "yaml";

/**
 * What an episode file says aloud, read the tolerant way the site reads it: the turns in order with
 * their text trimmed, and the voices the request asked for. A segment's stored address is a hash of
 * its text and voice, so the site (which plays an episode) and the engine (which narrates it ahead
 * of time) must read a file to the same words. Both read it here.
 */

export interface EpisodeScriptTurn {
  idx: number;
  speaker: "a" | "b";
  text: string;
  /** The story this turn is about, or null for a greeting, a link between stories or a sign-off. */
  item_id: string | null;
}

export interface EpisodeScript {
  id: string | null;
  /** In playing order, empty turns removed, a repeated idx kept once. */
  turns: EpisodeScriptTurn[];
  voice_id: string | null;
  voice_id_b: string | null;
}

const FENCE = "---";
/** A Speechify voice id as the engine accepts one; anything else reads as "the default". */
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isFieldRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field as trimmed text, null when it is empty or not text. */
export function episodeFieldText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** A voice id field, null when it is absent or not a voice id. */
export function readEpisodeVoice(value: unknown): string | null {
  const id = episodeFieldText(value);
  return id !== null && VOICE_ID.test(id) ? id : null;
}

/** The frontmatter of an episode file as a mapping. Throws a one-line error when it is not one. */
export function readEpisodeFrontmatter(fileText: string): Record<string, unknown> {
  const normalized = fileText.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) throw new Error("Episode file has no frontmatter");
  const end = normalized.indexOf(`\n${FENCE}`, FENCE.length);
  if (end < 0) throw new Error("Episode frontmatter is not closed");
  const raw: unknown = parse(normalized.slice(FENCE.length + 1, end));
  if (!isFieldRecord(raw)) throw new Error("Episode frontmatter is not a mapping");
  return raw;
}

export function readEpisodeTurns(value: unknown): EpisodeScriptTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: EpisodeScriptTurn[] = [];
  value.forEach((entry, position) => {
    if (!isFieldRecord(entry)) return;
    const body = episodeFieldText(entry.text);
    if (!body) return;
    const idx =
      typeof entry.idx === "number" && Number.isInteger(entry.idx) && entry.idx >= 0
        ? entry.idx
        : position;
    turns.push({
      idx,
      speaker: entry.speaker === "b" ? "b" : "a",
      text: body,
      item_id: episodeFieldText(entry.item_id),
    });
  });
  // The file's own numbering decides the order; a repeated number keeps the first.
  const seen = new Set<number>();
  return turns
    .sort((a, b) => a.idx - b.idx)
    .filter((turn) => !seen.has(turn.idx) && seen.add(turn.idx));
}

/** The id, turns and asked-for voices of an episode file. Throws when it has no frontmatter. */
export function readEpisodeScript(fileText: string): EpisodeScript {
  const raw = readEpisodeFrontmatter(fileText);
  const request = isFieldRecord(raw.request) ? raw.request : {};
  return {
    id: episodeFieldText(raw.id),
    turns: readEpisodeTurns(raw.turns),
    voice_id: readEpisodeVoice(request.voice_id),
    voice_id_b: readEpisodeVoice(request.voice_id_b),
  };
}
