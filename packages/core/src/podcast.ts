import { parse, stringify } from "yaml";
import { z } from "zod";
import { CoverSpec } from "./digest.js";
import { GENERAL_TOPICS, isGeneralTopicId } from "./generalTopics.js";

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
/** The formats a new request may ask for; a stored episode may still say "headlines". */
export const NEW_PODCAST_FORMATS = ["readout", "discussion"] as const;
export const PODCAST_WINDOWS = [2, 7, 30] as const;
export const PODCAST_TONES = ["neutral", "energetic", "dry"] as const;
export const PODCAST_AUDIENCES = ["general", "custom"] as const;

/** A Speechify voice id: the engine's own rule for a voice (see apps/web/src/server/config.ts). */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** A voice id, or null for the engine's default voice. */
export const VoiceId = z.string().regex(VOICE_ID_PATTERN).nullable();

/** A guard on the request's size, far above any topic list the app offers; the owner sets no limit. */
export const PODCAST_MAX_TOPICS = 50;

/**
 * The request as an episode file stores it: the fields, without the rules for a new request. An
 * episode made before a rule existed must keep parsing.
 */
export const StoredPodcastRequest = z.object({
  /** Section or category ids exactly as they appear in published digests. */
  topic_ids: z.array(z.string().min(1).max(64)).min(1).max(PODCAST_MAX_TOPICS),
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
  /** Speechify voice of the lead host (Ada). Absent or null means the engine's default. */
  voice_id: VoiceId.optional(),
  /** Voice of the second host (Leo, discussion only). Absent or null means the default. */
  voice_id_b: VoiceId.optional(),
});

/**
 * What the listener asks for. Validated again by the engine, so a hand-edited request fails
 * clearly. A new request is a readout or a discussion; headlines is no longer offered.
 */
export const PodcastRequest = StoredPodcastRequest.extend({
  format: z.enum(NEW_PODCAST_FORMATS),
}).superRefine((request, ctx) => {
  // A general episode is built from general news, so its topics come from the fixed general list.
  // A custom request keeps the section and category ids of published digests, checked as before.
  if (request.audience !== "general") return;
  const unknown = request.topic_ids.filter((id) => !isGeneralTopicId(id));
  if (unknown.length > 0) {
    const allowed = GENERAL_TOPICS.map((topic) => topic.id).join(", ");
    ctx.addIssue({
      code: "custom",
      path: ["topic_ids"],
      message: `A general episode takes only ${allowed}; not ${unknown.join(", ")}`,
    });
  }
});
/** The request as the engine handles it: the stored shape, so a regenerated headlines episode still fits. */
export type PodcastRequest = z.infer<typeof StoredPodcastRequest>;

export const PodcastFormat = z.enum(PODCAST_FORMATS);
export type PodcastFormat = z.infer<typeof PodcastFormat>;

/** `ep-YYYYMMDD-HHmm`, in Stockholm time. */
export const EpisodeId = z.string().regex(/^ep-\d{8}-\d{4}$/);
export type EpisodeId = z.infer<typeof EpisodeId>;

export const PODCAST_FEEDBACK_MAX = 500;

/** Listener feedback: control characters become spaces, the ends are trimmed, 1 to 500 characters. */
export const PodcastFeedback = z
  .string()
  // biome-ignore lint/suspicious/noControlCharactersInRegex: replacing control characters is the point
  .transform((text) => text.replace(/[\u0000-\u001F\u007F]/g, " ").trim())
  .pipe(z.string().min(1).max(PODCAST_FEEDBACK_MAX));

/**
 * What `podcast.yml` may pass in: a new episode (no `action`), a deletion, or a regeneration with
 * feedback. A request with no `action` is wrapped as `{ action: "create", request }`.
 */
export const PodcastCommand = z.preprocess(
  (raw) =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw) && !("action" in raw)
      ? { action: "create", request: raw }
      : raw,
  z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("create"), request: PodcastRequest }),
    z.strictObject({ action: z.literal("delete"), id: EpisodeId }),
    z.strictObject({
      action: z.literal("regenerate"),
      id: EpisodeId,
      feedback: PodcastFeedback,
    }),
  ]),
);
export type PodcastCommand = z.output<typeof PodcastCommand>;

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
  request: StoredPodcastRequest,
  generated_at: isoDateTime,
  listen_minutes: z.number().int().positive(),
  format: PodcastFormat,
  /** The episode this one replaced, when the listener asked for a regeneration. */
  replaces: EpisodeId.optional(),
  /** What the listener asked to change in the episode it replaced. */
  feedback: z.string().min(1).max(PODCAST_FEEDBACK_MAX).optional(),
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
