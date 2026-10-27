/**
 * Lays a briefing's narration out on one timeline before most of it exists.
 *
 * The server lists the segments a briefing is spoken in (an intro, then one per story) with each
 * one's character count and, once narrated, its file and length. From that list this module fixes
 * where every segment sits: a narrated segment takes its real length, the rest an estimate from
 * their characters. The player is then handed an ordinary briefing with ordinary story marks, and
 * trackAudio.ts plays the files against those marks.
 */
import type { PlayerDigestData } from "../types/contracts";
import type { TrackSegment } from "./trackAudio";

/** One entry of the lookup's `segments`. Structural, so it accepts the server contract as it is. */
export interface SegmentInfo {
  key: string;
  /** The story this segment reads, or null for the intro and the outro. */
  item_id: string | null;
  characters: number;
  /** `confirmed: false` means the address is where the file would be, not proof it is there. */
  audio: { url: string; duration_ms: number; confirmed?: boolean } | null;
}

export interface NarrationPlan {
  /** In playing order, each with its fixed span in seconds. */
  segments: TrackSegment[];
  total_ms: number;
  /** Where each story starts and ends, by item id: from its first segment to its last. */
  items: Map<string, { start_ms: number; end_ms: number }>;
  /** True when every segment already has a file, so playing needs no narration at all. */
  complete: boolean;
}

/** The source string the player loads for a planned narration. trackAudio resolves it to the playlist. */
export const NARRATION_SCHEME = "narration:";

export function narrationSource(digestId: string): string {
  return `${NARRATION_SCHEME}${digestId}`;
}

export function digestIdOfSource(src: string): string | null {
  return src.startsWith(NARRATION_SCHEME) ? src.slice(NARRATION_SCHEME.length) : null;
}

/** No segment is shorter than this on the timeline, so a story mark never collapses to nothing. */
const MIN_SEGMENT_MS = 500;

function segmentMs(segment: SegmentInfo, msPerCharacter: number): number {
  // An unconfirmed length is the server's own estimate, which the same sum reproduces.
  const known = segment.audio?.duration_ms;
  const length =
    known !== undefined && Number.isFinite(known) && known > 0
      ? known
      : segment.characters * msPerCharacter;
  return Math.max(MIN_SEGMENT_MS, Math.round(length));
}

export function planNarration(
  segments: readonly SegmentInfo[],
  msPerCharacter: number,
): NarrationPlan {
  const laid: TrackSegment[] = [];
  const items = new Map<string, { start_ms: number; end_ms: number }>();
  let cursor = 0;
  for (const segment of segments) {
    const start = cursor;
    cursor += segmentMs(segment, msPerCharacter);
    laid.push({
      key: segment.key,
      start: start / 1000,
      end: cursor / 1000,
      url: segment.audio?.url ?? null,
      unconfirmed: segment.audio?.confirmed === false,
    });
    if (segment.item_id !== null) {
      // Several segments can read one story (the turns of an episode). The story starts at its
      // first and ends at its last, so the marks cover everything said about it.
      const earlier = items.get(segment.item_id);
      items.set(segment.item_id, { start_ms: earlier?.start_ms ?? start, end_ms: cursor });
    }
  }
  return {
    segments: laid,
    total_ms: cursor,
    items,
    complete:
      segments.length > 0 &&
      segments.every((segment) => segment.audio !== null && segment.audio.confirmed !== false),
  };
}

/**
 * The briefing as the player wants it: an audio source, a length, and marks on every story. A story
 * the plan does not cover keeps null marks, which the player's timeline leaves out rather than
 * guesses.
 */
export function narratedDigest(
  digest: PlayerDigestData,
  plan: NarrationPlan,
  /** The episode as one Opus file, when it has one: tried first, then the turns by `narration:`. */
  opusUrl?: string,
): PlayerDigestData {
  const items = digest.items.map((item) => {
    const mark = plan.items.get(item.id);
    return { ...item, start_ms: mark?.start_ms ?? null, end_ms: mark?.end_ms ?? null };
  });
  const sections = digest.sections.map((section) => {
    const first = items.find((item) => item.section === section.slug && item.start_ms !== null);
    return { ...section, start_ms: first?.start_ms ?? null };
  });
  const spans = new Map(plan.segments.map((segment) => [segment.key, segment]));
  const turns = digest.turns?.map((turn) => {
    const span = spans.get(turn.key);
    return {
      ...turn,
      start_ms: span ? Math.round(span.start * 1000) : null,
      end_ms: span ? Math.round(span.end * 1000) : null,
    };
  });
  return {
    ...digest,
    ...(turns ? { turns } : {}),
    audio: {
      url: narrationSource(digest.id),
      duration_ms: plan.total_ms,
      ...(opusUrl ? { m4a_url: opusUrl } : {}),
    },
    timeline: "estimated",
    items,
    sections,
  };
}

/**
 * A finished episode's single Opus file and where each turn sits in it (published by the engine,
 * packages/engine/src/audio/segmentStore.ts EpisodeOpusManifest).
 */
export interface EpisodeOpusManifest {
  duration_ms: number;
  turns: { key: string; start_ms: number; end_ms: number }[];
}

/** The manifest in `value`, or null when it is not one whose turns run end to end from zero. */
export function parseEpisodeOpusManifest(value: unknown): EpisodeOpusManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const { duration_ms, turns } = value as { duration_ms?: unknown; turns?: unknown };
  if (typeof duration_ms !== "number" || !(duration_ms > 0) || !Array.isArray(turns)) return null;
  if (turns.length === 0) return null;
  const laid: EpisodeOpusManifest["turns"] = [];
  let cursor = 0;
  for (const turn of turns as Record<string, unknown>[]) {
    const { key, start_ms, end_ms } = turn ?? {};
    if (typeof key !== "string" || typeof start_ms !== "number" || typeof end_ms !== "number") {
      return null;
    }
    if (start_ms !== cursor || !(end_ms > start_ms)) return null;
    laid.push({ key, start_ms, end_ms });
    cursor = end_ms;
  }
  return cursor === duration_ms ? { duration_ms, turns: laid } : null;
}

/**
 * The lookup's turns with the lengths the single file has, so the turn-by-turn fallback is laid
 * out on exactly the same timeline as the file. Null when the manifest is for other turns: the
 * file is then not used.
 */
export function alignToManifest(
  segments: readonly SegmentInfo[],
  manifest: EpisodeOpusManifest,
): SegmentInfo[] | null {
  if (segments.length !== manifest.turns.length) return null;
  const aligned: SegmentInfo[] = [];
  for (const [index, segment] of segments.entries()) {
    const turn = manifest.turns[index];
    if (!turn || turn.key !== segment.key || !segment.audio) return null;
    aligned.push({
      ...segment,
      audio: { ...segment.audio, duration_ms: turn.end_ms - turn.start_ms },
    });
  }
  return aligned;
}
