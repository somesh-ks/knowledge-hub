import { parse, stringify } from "yaml";
import { z } from "zod";
import { CoverSpec } from "./digest.js";

const isoDateTime = z.string().datetime({ offset: true });

/**
 * Speech runs at 62 ms per character, so a minute holds 968 characters. The script is sized from
 * this alone: there is no audio to measure when the episode is planned.
 */
export const PODCAST_CHARS_PER_MINUTE = 968;
/** Hard ceiling on a script, whatever the request asks for. */
export const PODCAST_MAX_CHARS = 15_000;

export const PODCAST_LENGTHS = [3, 5, 10, 15] as const;
export const PODCAST_FORMATS = ["readout", "discussion", "headlines"] as const;
export const PODCAST_WINDOWS = [2, 7, 30] as const;
export const PODCAST_TONES = ["neutral", "energetic", "dry"] as const;
export const PODCAST_AUDIENCES = ["general", "custom"] as const;

/** What the listener asks for. Validated again by the engine, so a hand-edited request fails clearly. */
export const PodcastRequest = z.object({
  /** Section or category ids exactly as they appear in published digests. */
  topic_ids: z.array(z.string().min(1).max(64)).min(1).max(6),
  length_minutes: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(15)]),
  format: z.enum(PODCAST_FORMATS),
  window_days: z.union([z.literal(2), z.literal(7), z.literal(30)]),
  tone: z.enum(PODCAST_TONES),
  title: z.string().min(1).max(80).optional(),
  /**
   * Who the script is written for. "general" explains a term the first time it is used and leaves
   * out insider shorthand; "custom" is written for the owner, a design engineer. Absent means
   * "custom", so a request made before the field existed reads as it always did.
   */
  audience: z.enum(PODCAST_AUDIENCES).optional(),
});
export type PodcastRequest = z.infer<typeof PodcastRequest>;

export const PodcastFormat = z.enum(PODCAST_FORMATS);
export type PodcastFormat = z.infer<typeof PodcastFormat>;

/** `ep-YYYYMMDD-HHmm`, in Stockholm time. */
export const EpisodeId = z.string().regex(/^ep-\d{8}-\d{4}$/);
export type EpisodeId = z.infer<typeof EpisodeId>;

export const EpisodeSource = z.object({
  item_id: z.string().regex(/^[0-9a-f]{12}$/),
  url: z.string().url(),
  headline: z.string().min(1),
  source: z.string().min(1),
});
export type EpisodeSource = z.infer<typeof EpisodeSource>;

export const EpisodeTurn = z.object({
  /** Position in the script, from 0 with no gaps. */
  idx: z.number().int().nonnegative(),
  /** "a" is the lead host; "b" only speaks in a discussion. */
  speaker: z.enum(["a", "b"]),
  text: z.string().min(1),
  /** The story this turn is about. Open and sign-off turns carry none. */
  item_id: z
    .string()
    .regex(/^[0-9a-f]{12}$/)
    .optional(),
});
export type EpisodeTurn = z.infer<typeof EpisodeTurn>;

/** The frontmatter of an episode file. The Markdown body is the script, generated for readers. */
export const Episode = z.object({
  id: EpisodeId,
  title: z.string().min(1).max(120),
  request: PodcastRequest,
  generated_at: isoDateTime,
  listen_minutes: z.number().int().positive(),
  format: PodcastFormat,
  sources: z.array(EpisodeSource),
  turns: z.array(EpisodeTurn).min(1),
  /** Sum of the characters of every turn; what the narration is billed on. */
  char_count: z.number().int().positive().max(PODCAST_MAX_CHARS),
  cover: CoverSpec,
});
export type Episode = z.infer<typeof Episode>;

/** Repo-relative path of an episode file: Podcasts/YYYY/MM/<id>.md */
export function episodeRelPath(id: string): string {
  const parsed = EpisodeId.parse(id);
  return `Podcasts/${parsed.slice(3, 7)}/${parsed.slice(7, 9)}/${parsed}.md`;
}

const FENCE = "---";

/** Serialize an episode: YAML frontmatter plus the script as plain text. */
export function serializeEpisodeFile(episode: Episode): string {
  const valid = Episode.parse(episode);
  const front = stringify(valid, { lineWidth: 0 }).trimEnd();
  const lines = [`# ${valid.title}`, ""];
  const solo = valid.turns.every((turn) => turn.speaker === "a");
  for (const turn of valid.turns) {
    lines.push(solo ? turn.text : `${turn.speaker.toUpperCase()}: ${turn.text}`, "");
  }
  if (valid.sources.length > 0) {
    lines.push("## Sources", "");
    for (const source of valid.sources) {
      lines.push(`- [${source.headline}](${source.url}), ${source.source}`);
    }
    lines.push("");
  }
  return `${FENCE}\n${front}\n${FENCE}\n\n${lines.join("\n").trimEnd()}\n`;
}

/** Parse an episode file. The body is ignored: the frontmatter is the source of truth. */
export function parseEpisodeFile(text: string): Episode {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) throw new Error("Episode file has no frontmatter");
  const end = normalized.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (end < 0) throw new Error("Episode frontmatter is not closed");
  const raw: unknown = parse(normalized.slice(FENCE.length + 1, end));
  return Episode.parse(raw);
}
