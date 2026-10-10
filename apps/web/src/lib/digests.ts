import { type AudioTimeline, type Digest, type DigestItem, digestSections } from "@dispatch/core";
import { paletteAccent } from "@dispatch/cover";
import type { PlayerDigestData, PlayerItem, PlayerSection } from "../types/contracts";
import type { DigestSource } from "./digestFiles";
import { longDate } from "./format";
import { isWebUrl } from "./safeUrl";

/**
 * ready: the player can run. preparing: the text is out and narration is still being generated.
 * expired: the audio was pruned but its timeline is kept (build plan 7.7), so the page says so.
 */
export type AudioMode = "ready" | "preparing" | "expired";

export interface DigestEntry {
  id: string;
  digest: Digest;
  timeline: AudioTimeline | null;
  audioMode: AudioMode;
  /** Items in reading order: by section, then the digest's own order. Index matches the player. */
  items: DigestItem[];
  /** The previous (older) and next (newer) digest ids. */
  prevId: string | null;
  nextId: string | null;
  player: PlayerDigestData;
}

export interface BuildOptions {
  /** Rewrites an audio URL, used only to point fixture digests at a same-origin file. */
  resolveAudioUrl?: (url: string) => string;
}

export function audioModeOf(digest: Digest, timeline: AudioTimeline | null): AudioMode {
  if (digest.audio && timeline) return "ready";
  if (!digest.audio && timeline) return "expired";
  return "preparing";
}

/**
 * Reading order, which is also narration order: the digest's sections in their order, items in
 * digest order inside each. The sections are the digest's own, so one that came with a topic the
 * owner added takes its place among the built-in ones.
 */
export function orderItems(digest: Pick<Digest, "items" | "section_titles">): DigestItem[] {
  return digestSections(digest).flatMap((section) =>
    digest.items.filter((item) => item.section === section.id),
  );
}

/** Newest first. Same-day digests (a second run, a weekly) fall back to when they were written. */
export function compareNewestFirst(a: Digest, b: Digest): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.generated_at !== b.generated_at) return a.generated_at < b.generated_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

function playerItems(items: DigestItem[], timeline: AudioTimeline | null): PlayerItem[] {
  const timed = new Map(timeline?.items.map((entry) => [entry.id, entry]));
  return items.map((item) => ({
    id: item.id,
    headline: item.headline,
    section: item.section,
    source: item.source,
    url: isWebUrl(item.url) ? item.url : null,
    start_ms: timed.get(item.id)?.start_ms ?? null,
    end_ms: timed.get(item.id)?.end_ms ?? null,
  }));
}

function playerSections(digest: Digest, timeline: AudioTimeline | null): PlayerSection[] {
  const starts = new Map<string, number>(
    timeline?.sections.map((entry) => [entry.slug, entry.start_ms]),
  );
  return digestSections(digest).map((section) => ({
    slug: section.id,
    title: section.title,
    start_ms: starts.get(section.id) ?? null,
  }));
}

function toEntry(
  source: DigestSource,
  prevId: string | null,
  nextId: string | null,
  options: BuildOptions,
): DigestEntry {
  const { digest, timeline } = source;
  const audioMode = audioModeOf(digest, timeline);
  const items = orderItems(digest);
  const resolve = options.resolveAudioUrl ?? ((url: string) => url);
  const player: PlayerDigestData = {
    id: digest.id,
    date: digest.date,
    title: longDate(digest.date),
    kind: digest.kind,
    audio:
      audioMode === "ready" && digest.audio
        ? { url: resolve(digest.audio.url), duration_ms: digest.audio.duration_ms }
        : null,
    timeline: audioMode === "ready" ? (timeline?.timeline ?? null) : null,
    items: playerItems(items, audioMode === "ready" ? timeline : null),
    sections: playerSections(digest, audioMode === "ready" ? timeline : null),
    cover: {
      src512: `/covers/${digest.id}-512.webp`,
      src1024: `/covers/${digest.id}-1024.webp`,
      key: paletteAccent(digest.cover.palette).light,
    },
    prev_id: prevId,
    next_id: nextId,
  };
  return { id: digest.id, digest, timeline, audioMode, items, prevId, nextId, player };
}

/**
 * Sorts newest first, derives each entry and links neighbours. A digest whose cover palette is
 * unknown cannot be drawn, so it is left out with a warning instead of failing the whole build.
 */
export function buildEntries(
  sources: readonly DigestSource[],
  options: BuildOptions = {},
  warn: (message: string) => void = () => {},
): DigestEntry[] {
  const drawable = sources.filter((source) => {
    try {
      paletteAccent(source.digest.cover.palette);
      return true;
    } catch {
      warn(`${source.digest.id}: unknown cover palette "${source.digest.cover.palette}", skipped`);
      return false;
    }
  });
  const sorted = [...drawable].sort((a, b) => compareNewestFirst(a.digest, b.digest));
  return sorted.map((source, index) =>
    toEntry(
      source,
      sorted[index + 1]?.digest.id ?? null,
      sorted[index - 1]?.digest.id ?? null,
      options,
    ),
  );
}
