/**
 * Playing an episode that is still being written. The player's track is a list of turns whose files
 * are made on Play; here the list starts as the turns the engine had written when Play was pressed
 * and grows as it writes more (lib/liveStream.ts). The turns are narrated by the same /api/narrate
 * calls as any episode: the server reads the live copy for an id it has not committed yet.
 *
 * Only the data side lives here. trackAudio.ts holds the end of the track while `growth.pending()`
 * says more may come, and the controller (narrationController.ts) hands this to the playlist.
 */
import type { StreamDoc } from "../lib/liveStream";
import type { PlayerDigestData } from "../types/contracts";
import type { Playlist, TrackSegment } from "./trackAudio";

type Growth = NonNullable<Playlist["growth"]>;

/** The wait between two looks at the live copy while the player has nothing left to say. */
export const GROWTH_POLL_MS = 1500;
/**
 * No more turns for this long while the writer reports it is still going: the run has probably died
 * without saying so. The track ends where it is; the committed episode is the way on if it comes.
 */
export const GROWTH_GIVE_UP_MS = 4 * 60_000;
const MIN_SEGMENT_MS = 500;

export interface GrowthDeps {
  /** The live copy now, or null when it cannot be read this time. */
  fetchDoc(): Promise<StreamDoc | null>;
  delay(milliseconds: number): Promise<void>;
  now(): number;
  /** How long a character takes to say, as the first lookup gave it. */
  msPerCharacter: number;
  pollMs?: number;
  giveUpMs?: number;
}

/**
 * Lets a track grow with the script. `segments` is the track's own array: turns are appended to it,
 * each starting where the last ends, so the timeline only ever gets longer at the end.
 */
export function createGrowth(
  segments: TrackSegment[],
  initial: Pick<StreamDoc, "status">,
  deps: GrowthDeps,
): Growth {
  let status = initial.status;

  function append(doc: StreamDoc): number {
    let added = 0;
    for (let idx = segments.length; idx < doc.turns.length; idx += 1) {
      const turn = doc.turns[idx];
      if (!turn) break;
      const start = segments[segments.length - 1]?.end ?? 0;
      const ms = Math.max(MIN_SEGMENT_MS, Math.round(turn.text.length * deps.msPerCharacter));
      segments.push({ key: `t${idx}`, start, end: start + ms / 1000, url: null });
      added += 1;
    }
    return added;
  }

  return {
    pending: () => status === "writing",
    async waitForMore() {
      const limit = deps.now() + (deps.giveUpMs ?? GROWTH_GIVE_UP_MS);
      for (;;) {
        const doc = await deps.fetchDoc().catch(() => null);
        if (doc) {
          status = doc.status;
          if (append(doc) > 0) return true;
          if (status !== "writing") return false;
        }
        if (deps.now() >= limit) {
          status = "failed";
          return false;
        }
        await deps.delay(deps.pollMs ?? GROWTH_POLL_MS);
      }
    },
  };
}

/** The player's copy of a live episode: its turns so far and the stories they refer to. */
export function liveDigestFrom(doc: StreamDoc, now: Date): PlayerDigestData {
  const date = now.toISOString().slice(0, 10);
  return {
    id: doc.id,
    date,
    title: doc.title,
    kind: "on-demand",
    audio: null,
    timeline: null,
    items: doc.stories.map((story) => ({
      id: story.item_id,
      headline: story.headline,
      section: story.section,
      source: story.source,
      url: story.url,
      start_ms: null,
      end_ms: null,
    })),
    sections: [],
    turns: doc.turns.map((turn, idx) => ({
      key: `t${idx}`,
      speaker: turn.speaker,
      text: turn.text,
      item_id: turn.item_id ?? null,
      start_ms: null,
      end_ms: null,
    })),
    hosts: doc.hosts,
    voices: doc.voices,
    format: doc.format,
    // Its cover may not be drawn yet: until the file exists the image fails and PlayerCover shows the
    // branded fallback (cover.css), so the player never shows a broken or empty cover.
    cover: {
      src512: `/covers/${doc.id}-512.webp`,
      src1024: `/covers/${doc.id}-1024.webp`,
      key: "var(--accent)",
    },
    prev_id: null,
    next_id: null,
  };
}
