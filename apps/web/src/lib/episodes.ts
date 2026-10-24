import type { CoverSpec } from "@dispatch/core";
import { PALETTE_IDS, paletteAccent, pickCover, TEMPLATES } from "@dispatch/cover";
import type { PlayerDigestData } from "../types/contracts";
import { type ContentFiles, diskFiles } from "./contentFiles";
import { type Episode, parseEpisodeFile } from "./episodeFile";
import { isWebUrl } from "./safeUrl";

/**
 * Podcast episodes as the pages see them, read at build time from Podcasts/YYYY/MM/<id>.md. A
 * folder that does not exist yet means no episodes. A file that does not parse is skipped with a
 * warning, so one bad file never takes the site down.
 */

export { FORMAT_LABELS } from "./formatLabels";

/** "8 min": how long an episode takes to hear, which its page's play controls say before it plays. */
export function episodeLength(episode: Pick<Episode, "listen_minutes">): string {
  return `${episode.listen_minutes} min`;
}

export interface EpisodeEntry {
  id: string;
  episode: Episode;
  /** The cover to draw: the file's own, or one picked from the id when the file names none. */
  cover: CoverSpec;
  /** What the player reads from the page, in the shape a briefing uses. */
  player: PlayerDigestData;
}

export interface EpisodeFiles {
  episodes: Episode[];
  warnings: string[];
}

export async function readEpisodeFiles(
  directory: string,
  reader: ContentFiles = diskFiles,
): Promise<EpisodeFiles> {
  const episodes: Episode[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const file of (await reader.list(directory)).filter((path) => path.endsWith(".md"))) {
    try {
      const text = await reader.read(file);
      if (text === null) continue;
      const episode = parseEpisodeFile(text);
      if (seen.has(episode.id)) {
        warnings.push(`${file}: duplicate episode id ${episode.id}, skipped`);
        continue;
      }
      seen.add(episode.id);
      episodes.push(episode);
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : "unreadable";
      warnings.push(`${file}: ${reason}, skipped`);
    }
  }
  return { episodes, warnings };
}

/** The file's cover when it can be drawn, otherwise one picked from the id. */
function coverOf(episode: Episode): CoverSpec {
  const named = episode.cover;
  if (
    named &&
    (PALETTE_IDS as readonly string[]).includes(named.palette) &&
    (TEMPLATES as readonly string[]).includes(named.template)
  ) {
    return named as CoverSpec;
  }
  return pickCover({ id: episode.id, date: episode.date, kind: "regular" });
}

/** The one section an episode's sources sit in, so the player's story list works unchanged. */
export const EPISODE_SECTION = { slug: "top", title: "Stories" } as const;

function toEntry(episode: Episode): EpisodeEntry {
  const cover = coverOf(episode);
  const items = episode.sources.map((source) => ({
    id: source.item_id,
    headline: source.headline,
    section: EPISODE_SECTION.slug,
    source: source.source,
    url: isWebUrl(source.url) ? source.url : null,
    start_ms: null,
    end_ms: null,
  }));
  const player: PlayerDigestData = {
    id: episode.id,
    date: episode.date,
    title: episode.title,
    kind: "regular",
    // Narrated when Play is pressed, like a briefing without audio.
    audio: null,
    timeline: null,
    items,
    // The segment key is the turn's index behind a t, as the narration names them.
    turns: episode.turns.map((turn) => ({
      key: `t${turn.idx}`,
      speaker: turn.speaker,
      text: turn.text,
      item_id: turn.item_id,
      start_ms: null,
      end_ms: null,
    })),
    // What the two voices of a discussion are called. A discussion made before names were stored has
    // none here, and the transcript names its hosts after its voices (lib/hosts.ts).
    hosts: episode.request.host_names ?? null,
    // The voices it was asked for; null for a host stands for the default voice, as the engine
    // reads it. They name the hosts of a discussion that stored no names.
    voices: { a: episode.request.voice_id ?? null, b: episode.request.voice_id_b ?? null },
    // The word the Library uses for it, so the player says the same.
    format: episode.format,
    sections:
      items.length > 0
        ? [{ slug: EPISODE_SECTION.slug, title: EPISODE_SECTION.title, start_ms: null }]
        : [],
    cover: {
      src512: `/covers/${episode.id}-512.webp`,
      src1024: `/covers/${episode.id}-1024.webp`,
      key: paletteAccent(cover.palette).light,
    },
    prev_id: null,
    next_id: null,
  };
  return { id: episode.id, episode, cover, player };
}

/** Newest first, by when each was written. */
export function buildEpisodeEntries(episodes: readonly Episode[]): EpisodeEntry[] {
  return [...episodes]
    .sort((a, b) =>
      a.generated_at < b.generated_at ? 1 : a.generated_at > b.generated_at ? -1 : 0,
    )
    .map(toEntry);
}
