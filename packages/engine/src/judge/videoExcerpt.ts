import type { Item, JudgmentsFile } from "@singularity/core";
import type { Logger } from "../context.js";
import type { ExtractedText } from "../extract/extractText.js";
import { STATE_LIMITS } from "./questions.js";

const GAP = " … ";
/** Where in the transcript the excerpt samples: past the opening, where a sponsor read usually sits. */
const SAMPLE_AT = [0.15, 0.45, 0.75] as const;

/**
 * A snippet's worth of what the video says: three stretches spread through the transcript, so a
 * sponsor read, which fills one stretch at most, does not stand for the whole video.
 */
export function transcriptExcerpt(text: string, limit: number = STATE_LIMITS.snippetChars): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const part = Math.floor((limit - GAP.length * (SAMPLE_AT.length - 1)) / SAMPLE_AT.length);
  return SAMPLE_AT.map((at) => {
    const start = Math.floor(clean.length * at);
    return clean.slice(start, start + part).trim();
  }).join(GAP);
}

export interface VideoExcerpts {
  /** The items in order; a favorite creator's video that has a transcript carries its excerpt as the snippet. */
  items: Item[];
  /** Ids of the videos now judged on what they say. */
  transcribed: Set<string>;
}

/**
 * Show the judge what a favorite creator's video says in place of its description. The judge
 * sees a title and a snippet, and a video's description is links and sponsor lines, so it rated
 * every such video as promotion (21 of 21, 2026-10-09 to 10-30). Transcripts come through the run's
 * extractor, which caches them, so a video is paid for once. A video with no transcript keeps its description.
 */
export async function withVideoExcerpts(
  items: readonly Item[],
  extract: (item: Item) => Promise<ExtractedText | null>,
  log?: Logger,
): Promise<VideoExcerpts> {
  const out: Item[] = [];
  const transcribed = new Set<string>();
  for (const item of items) {
    if (item.source_type !== "youtube" || !item.signals.creator_vetted) {
      out.push(item);
      continue;
    }
    let spoken: ExtractedText | null = null;
    try {
      spoken = await extract(item);
    } catch (error) {
      log?.warn("A favorite creator's video could not be read; it is judged on its description", {
        itemId: item.id,
        reason: String(error).slice(0, 120),
      });
    }
    if (!spoken || spoken.method === "snippet") {
      log?.info("Favorite creator video judged on its description", { itemId: item.id });
      out.push(item);
      continue;
    }
    transcribed.add(item.id);
    log?.info("Favorite creator video judged on its transcript", {
      itemId: item.id,
      channel: item.source_id,
      method: spoken.method,
    });
    out.push({ ...item, snippet: transcriptExcerpt(spoken.text) });
  }
  return { items: out, transcribed };
}

/** The cache without these items, so they are judged again: an entry from their description would be read as current. */
export function withoutJudgments(cache: JudgmentsFile, ids: ReadonlySet<string>): JudgmentsFile {
  if (ids.size === 0) return cache;
  const kept = Object.entries(cache.entries).filter(([, entry]) => !ids.has(entry.item_id));
  return { version: 1, entries: Object.fromEntries(kept) };
}
