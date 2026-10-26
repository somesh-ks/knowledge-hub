import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type Episode,
  episodeRelPath,
  generalTopicTitle,
  isGeneralTopicId,
  PODCAST_CHARS_PER_MINUTE,
  type PodcastRequest,
  SECTION_TITLES,
  type Section,
  serializeEpisodeFile,
} from "@singularity/core";
import { createFallbackCoverPicker, loadCoverPalettes } from "../render/coverPicker.js";
import type { PodcastStory, ScriptTurn } from "./types.js";

const MINUTE_MS = 60_000;
const MAX_ID_TRIES = 60;

const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `ep-YYYYMMDD-HHmm` in Stockholm time, the clock the digests use. */
export function episodeIdAt(at: Date): string {
  const part = (type: string): string =>
    STAMP.formatToParts(at).find((p) => p.type === type)?.value ?? "00";
  return `ep-${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The id for this minute, or the next free minute when a file already holds it. */
export async function allocateEpisodeId(root: string, now: Date): Promise<string> {
  for (let step = 0; step < MAX_ID_TRIES; step++) {
    const id = episodeIdAt(new Date(now.getTime() + step * MINUTE_MS));
    if (!(await exists(join(root, episodeRelPath(id))))) return id;
  }
  throw new Error("No free episode id in the next hour.");
}

export function topicLabel(topic: string): string {
  if (topic in SECTION_TITLES) return SECTION_TITLES[topic as Section];
  const words = topic.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The topic names a title reads out. A request now mixes section ids and general topic ids, and the
 * form sends two ids for Design, so ids that read the same are named once: "Design" for design and
 * ui-craft, "Technology" for tech and technology, "AI" for ai.
 */
const TITLE_NAMES: Record<string, string> = {
  design: "Design",
  "ui-craft": "Design",
  ai: "AI",
  tech: "Technology",
};

export function titleNames(topics: readonly string[]): string[] {
  const names = topics.map(
    (id) => TITLE_NAMES[id] ?? (isGeneralTopicId(id) ? generalTopicTitle(id) : topicLabel(id)),
  );
  return names.filter((name, index) => names.indexOf(name) === index);
}

/** How many topics a default title names before it says "and N more". */
const TITLE_TOPICS = 2;

/**
 * The listener's title, or a short one made of the topics: "AI and Design", or the first
 * two "and 2 more". It sits under album art in a grid, so it has to read in two short lines.
 */
export function episodeTitle(request: PodcastRequest): string {
  if (request.title) return request.title;
  const names = titleNames(request.topic_ids);
  if (names.length <= TITLE_TOPICS) return names.join(" and ");
  const rest = names.length - TITLE_TOPICS;
  return `${names.slice(0, TITLE_TOPICS).join(", ")} and ${rest} more`;
}

export interface BuildEpisodeInput {
  root: string;
  id: string;
  now: Date;
  request: PodcastRequest;
  stories: readonly PodcastStory[];
  turns: readonly ScriptTurn[];
  /** Set when the episode replaces an earlier one. */
  replaces?: string;
  feedback?: string;
  /** Chosen by the cover stage; absent, it is chosen here. */
  cover?: Episode["cover"];
}

export async function buildEpisode(input: BuildEpisodeInput): Promise<Episode> {
  const used = new Set(input.turns.flatMap((turn) => (turn.item_id ? [turn.item_id] : [])));
  // Sources follow the order the script first mentions them.
  const order = new Map<string, number>();
  for (const turn of input.turns) {
    if (turn.item_id && !order.has(turn.item_id)) order.set(turn.item_id, order.size);
  }
  const sources = input.stories
    .filter((story) => used.has(story.item_id))
    .sort((a, b) => (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0))
    .map((story) => ({
      item_id: story.item_id,
      url: story.url,
      headline: story.headline,
      source: story.source,
    }));
  const charCount = input.turns.reduce((sum, turn) => sum + turn.text.length, 0);
  return {
    id: input.id,
    title: episodeTitle(input.request),
    request: input.request,
    ...(input.replaces ? { replaces: input.replaces } : {}),
    ...(input.feedback ? { feedback: input.feedback } : {}),
    generated_at: input.now.toISOString(),
    listen_minutes: Math.max(1, Math.round(charCount / PODCAST_CHARS_PER_MINUTE)),
    format: input.request.format,
    sources,
    turns: input.turns.map((turn, idx) => ({
      idx,
      speaker: turn.speaker,
      text: turn.text,
      ...(turn.item_id ? { item_id: turn.item_id } : {}),
    })),
    char_count: charCount,
    cover: input.cover ?? (await pickEpisodeCover(input.root, input.id)),
  };
}

/** The cover an episode gets, from its id alone: no model is called, so it is ready at once. */
export async function pickEpisodeCover(root: string, id: string): Promise<Episode["cover"]> {
  const pick = createFallbackCoverPicker({ palettes: await loadCoverPalettes(root) });
  return pick({ digestId: id, date: id.slice(3, 11), kind: "on-demand", items: [] });
}

/** Write `Podcasts/YYYY/MM/<id>.md`, never over an existing file. */
export async function writeEpisodeFile(
  root: string,
  episode: Episode,
): Promise<{ path: string; relPath: string }> {
  const relPath = episodeRelPath(episode.id);
  const path = join(root, relPath);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, serializeEpisodeFile(episode), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Episode file already exists: ${relPath}. Episodes are never overwritten.`);
    }
    throw error;
  }
  return { path, relPath };
}
