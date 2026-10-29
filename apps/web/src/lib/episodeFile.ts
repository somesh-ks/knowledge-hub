import {
  type EpisodeScriptTurn,
  episodeFieldText,
  HOST_NAME_PATTERN,
  isFieldRecord,
  MAX_REGENERATIONS,
  readEpisodeFrontmatter,
  readEpisodeTurns,
  readEpisodeVoice,
  stockholmDate,
} from "@singularity/core";
import type { PodcastRequest } from "../types/contracts";

/**
 * Reads one episode file: Podcasts/YYYY/MM/<id>.md, YAML frontmatter and a body the site ignores.
 *
 * The parser is tolerant on purpose. The engine that writes episodes lives on another branch, so a
 * field it adds is ignored and a field it omits gets a sensible default. What cannot be defaulted
 * (the id, the turns) fails the file, and the caller skips it with a warning.
 *
 * Shared by the build (the pages) and the narrate function, so it imports nothing from either.
 */

export const EPISODE_ID = /^ep-\d{8}-\d{4}$/;

export interface EpisodeSource {
  item_id: string;
  url: string;
  headline: string;
  source: string;
}

/** Read by @singularity/core, which the engine shares, so both narrate a turn from the same words. */
export type EpisodeTurn = EpisodeScriptTurn;

export interface EpisodeCover {
  palette: string;
  template: string;
  seed: number;
}

export interface Episode {
  id: string;
  title: string;
  request: PodcastRequest;
  /** Stockholm calendar date of generated_at, YYYY-MM-DD. */
  date: string;
  generated_at: string;
  listen_minutes: number;
  format: PodcastRequest["format"];
  sources: EpisodeSource[];
  /** In playing order, empty turns removed. */
  turns: EpisodeTurn[];
  char_count: number;
  /** Null when the file names none; the build then picks one. */
  cover: EpisodeCover | null;
  /** Regenerations in this episode's line (D212); absent when it was never regenerated. */
  regenerations?: number;
}

const LENGTHS = [3, 5, 10, 15] as const;
const FORMATS = ["readout", "discussion", "headlines"] as const;
const WINDOWS = [2, 7, 30] as const;
const TONES = ["neutral", "energetic"] as const;
/** Narration pace, in characters a minute. The estimate on the Create page uses the same figure. */
export const CHARS_PER_MINUTE = 960;

const isRecord = isFieldRecord;
const text = episodeFieldText;

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

function instant(value: unknown): string | null {
  const raw = value instanceof Date ? value.toISOString() : text(value);
  return raw !== null && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

const voice = readEpisodeVoice;

/**
 * The names a discussion was written with, as the engine stores them. Null when the file has none
 * (a discussion made before names were stored was written with Ada and Leo) or either is not a name.
 */
function hostNames(value: unknown): PodcastRequest["host_names"] | null {
  if (!isRecord(value)) return null;
  const a = text(value.a);
  const b = text(value.b);
  return a && b && HOST_NAME_PATTERN.test(a) && HOST_NAME_PATTERN.test(b) ? { a, b } : null;
}

function readRequest(value: unknown, format: PodcastRequest["format"]): PodcastRequest {
  const raw = isRecord(value) ? value : {};
  const topics = Array.isArray(raw.topic_ids)
    ? raw.topic_ids.map(text).filter((topic): topic is string => topic !== null)
    : [];
  const title = text(raw.title);
  const voiceId = voice(raw.voice_id);
  const voiceIdB = voice(raw.voice_id_b);
  const names = hostNames(raw.host_names);
  return {
    topic_ids: topics,
    length_minutes: oneOf(raw.length_minutes, LENGTHS, 5),
    format,
    window_days: oneOf(raw.window_days, WINDOWS, 2),
    tone: oneOf(raw.tone, TONES, "neutral"),
    ...(title ? { title } : {}),
    ...(voiceId ? { voice_id: voiceId } : {}),
    ...(voiceIdB ? { voice_id_b: voiceIdB } : {}),
    ...(names ? { host_names: names } : {}),
  };
}

function readSources(value: unknown): EpisodeSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: EpisodeSource[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const itemId = text(entry.item_id);
    const headline = text(entry.headline);
    if (!itemId || !headline || seen.has(itemId)) continue;
    seen.add(itemId);
    sources.push({
      item_id: itemId,
      url: text(entry.url) ?? "",
      headline,
      source: text(entry.source) ?? "",
    });
  }
  return sources;
}

const readTurns = readEpisodeTurns;

function readCover(value: unknown): EpisodeCover | null {
  if (!isRecord(value)) return null;
  const palette = text(value.palette);
  const template = text(value.template);
  if (!palette || !template) return null;
  const seed = typeof value.seed === "number" && Number.isFinite(value.seed) ? value.seed : 0;
  return { palette, template, seed };
}

/** The episode in a file's text. Throws a one-line error when it cannot be one. */
export function parseEpisodeFile(fileText: string): Episode {
  const raw = readEpisodeFrontmatter(fileText);

  const id = text(raw.id);
  if (!id || !EPISODE_ID.test(id))
    throw new Error(`Episode id "${id ?? ""}" is not ep-YYYYMMDD-HHmm`);
  const turns = readTurns(raw.turns);
  if (turns.length === 0) throw new Error(`Episode ${id} has no turns`);
  const generatedAt = instant(raw.generated_at);
  if (!generatedAt) throw new Error(`Episode ${id} has no generated_at`);

  const request = isRecord(raw.request) ? raw.request : {};
  const format = oneOf(raw.format ?? request.format, FORMATS, "readout");
  const chars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  const declared = typeof raw.char_count === "number" && raw.char_count > 0 ? raw.char_count : 0;
  const charCount = declared || chars;
  const minutes =
    typeof raw.listen_minutes === "number" && raw.listen_minutes > 0
      ? Math.round(raw.listen_minutes)
      : Math.max(1, Math.round(charCount / CHARS_PER_MINUTE));

  const readRequestFields = readRequest(request, format);
  const requestTitle = readRequestFields.title;
  return {
    id,
    title: text(raw.title) ?? requestTitle ?? "Your episode",
    request: readRequestFields,
    date: stockholmDate(new Date(generatedAt)),
    generated_at: generatedAt,
    listen_minutes: minutes,
    format,
    sources: readSources(raw.sources),
    turns,
    char_count: charCount,
    cover: readCover(raw.cover),
    ...(typeof raw.regenerations === "number" && Number.isInteger(raw.regenerations)
      ? { regenerations: Math.max(0, Math.min(raw.regenerations, MAX_REGENERATIONS)) }
      : {}),
  };
}
