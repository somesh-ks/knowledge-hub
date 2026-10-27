/**
 * The live copy of an episode's script, as the engine writes it to Blob while it is written
 * (packages/engine/src/podcast/stream.ts), and what the site does with it. Types and checks only:
 * the server reads it, the run indicator polls it, the player plays from it.
 *
 * The committed episode stays the source of truth. A live copy is temporary, and may be missing,
 * stale or cut short; every reader treats it that way.
 */
export type StreamStatus = "writing" | "done" | "failed";

export interface StreamTurn {
  speaker: "a" | "b";
  text: string;
  item_id?: string;
}

export interface StreamStory {
  item_id: string;
  headline: string;
  source: string;
  url: string;
  section: string;
}

export interface StreamDoc {
  id: string;
  title: string;
  status: StreamStatus;
  turns: StreamTurn[];
  voices: { a: string | null; b: string | null };
  hosts: { a: string; b: string } | null;
  format: "readout" | "discussion" | "headlines";
  stories: StreamStory[];
  /** The cover box's colour until the drawn cover is deployed; a hex colour, or absent. */
  cover_key?: string;
  updated_at: string;
}

export const STREAM_EPISODE_ID = /^ep-\d{8}-\d{4}$/;
/** The player sets the cover colour as a CSS value, so only a plain hex colour is let through. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** A script is some thousand turns at most; a bigger document is not one of ours. */
const MAX_TURNS = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const voice = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The document in a Blob object, rebuilt field by field, or null when it is not one of ours. */
export function parseStreamDoc(text: string): StreamDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { id, title, status, turns, stories, format } = raw;
  if (typeof id !== "string" || !STREAM_EPISODE_ID.test(id)) return null;
  if (typeof title !== "string") return null;
  if (status !== "writing" && status !== "done" && status !== "failed") return null;
  if (format !== "readout" && format !== "discussion" && format !== "headlines") return null;
  if (!Array.isArray(turns) || turns.length > MAX_TURNS) return null;
  const parsedTurns: StreamTurn[] = [];
  for (const turn of turns) {
    if (!isRecord(turn)) return null;
    if ((turn.speaker !== "a" && turn.speaker !== "b") || typeof turn.text !== "string")
      return null;
    parsedTurns.push({
      speaker: turn.speaker,
      text: turn.text,
      ...(typeof turn.item_id === "string" ? { item_id: turn.item_id } : {}),
    });
  }
  const parsedStories: StreamStory[] = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    if (!isRecord(story)) continue;
    const { item_id, headline, source, url, section } = story;
    if (
      typeof item_id === "string" &&
      typeof headline === "string" &&
      typeof source === "string" &&
      typeof url === "string" &&
      typeof section === "string"
    ) {
      parsedStories.push({ item_id, headline, source, url, section });
    }
  }
  const voices = isRecord(raw.voices) ? raw.voices : {};
  const hosts = isRecord(raw.hosts) ? raw.hosts : null;
  return {
    id,
    title,
    status,
    turns: parsedTurns,
    voices: { a: voice(voices.a), b: voice(voices.b) },
    hosts:
      hosts && typeof hosts.a === "string" && typeof hosts.b === "string"
        ? { a: hosts.a, b: hosts.b }
        : null,
    format,
    stories: parsedStories,
    ...(typeof raw.cover_key === "string" && HEX_COLOR.test(raw.cover_key)
      ? { cover_key: raw.cover_key }
      : {}),
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

/** Where the narration can start: the first turns are there. */
export const hasFirstTurns = (doc: StreamDoc): boolean => doc.turns.length > 0;

/**
 * Whether a player that has reached the end of `have` turns should wait for more instead of ending:
 * the script is still being written. A finished or failed stream, or a fetch that found nothing,
 * ends the episode there.
 */
export function shouldWaitForMore(status: StreamStatus | null): boolean {
  return status === "writing";
}

/** The turns of a newer copy that a player holding `have` turns has not got yet. */
export function newTurns(have: number, doc: StreamDoc): StreamTurn[] {
  return doc.turns.slice(have);
}
