import type { DigestKind, Section } from "@dispatch/core";

/**
 * Contracts shared by the reader pages, the player island and the Generate sheet. Both the page
 * author and the player author build against these types; change them only together.
 */

export interface PlayerItem {
  id: string;
  headline: string;
  section: Section;
  source: string;
  /**
   * The story's source page, already checked to be http or https, or null when it is not safe to
   * link. Optional because a page cached before this field existed does not carry it.
   */
  url?: string | null;
  /** Start and end inside the MP3, or null while the digest has no audio. */
  start_ms: number | null;
  end_ms: number | null;
}

export interface PlayerSection {
  slug: Section;
  title: string;
  start_ms: number | null;
}

/**
 * Rendered on every digest page as `<script type="application/json" id="dispatch-digest-data">`.
 * The player reads it on `astro:page-load` and keeps playing the current track until the listener
 * chooses another digest, so audio survives client-side navigation.
 */
export interface PlayerDigestData {
  id: string;
  /** Stockholm date, YYYY-MM-DD. */
  date: string;
  /** English long date, "Wednesday 7 October". */
  title: string;
  kind: DigestKind;
  audio: { url: string; duration_ms: number } | null;
  /** How the item times were derived, or null when there is no audio. */
  timeline: "marks" | "estimated" | null;
  items: PlayerItem[];
  sections: PlayerSection[];
  cover: {
    src512: string;
    src1024: string;
    /** CSS color from the cover palette accent, used for --cover-key. */
    key: string;
  };
  /** Neighbouring digests for "Up next" (the previous digest) and archive hops. */
  prev_id: string | null;
  next_id: string | null;
}

/** POST /api/generate request body. */
export interface GenerateRequest {
  passphrase: string;
}

/** POST /api/generate responses. */
export type GenerateResponse =
  | { status: 202; run_id: number; started_at: string }
  | { status: 400; error: "invalid_request" }
  | { status: 401; error: "wrong_passphrase" }
  | { status: 429; error: "cooldown" | "daily_cap"; retry_after_s: number }
  | { status: 503; error: "unavailable" };

/** Steps shown in the Generate sheet, mapped from the workflow's job step names. */
export const GENERATE_STEPS = [
  "waiting",
  "reading",
  "judging",
  "writing",
  "checking",
  "publishing",
] as const;
export type GenerateStep = (typeof GENERATE_STEPS)[number];

/**
 * Workflow step name to progress step. The names are defined in .github/workflows/run.yml and
 * audio.yml; keep them in sync.
 */
export const STEP_FOR_WORKFLOW_STEP: Record<string, GenerateStep> = {
  Gate: "waiting",
  Fetch: "reading",
  Judge: "judging",
  Write: "writing",
  Validate: "checking",
  Commit: "publishing",
  Audio: "publishing",
};

/** GET /api/status?run=<id> response body. */
export interface StatusResponse {
  run_id: number;
  state: "queued" | "running" | "completed";
  step: GenerateStep | null;
  /** Present once state is "completed". Read from state/last-run.json. */
  outcome?: "published" | "nothing" | "gated" | "failed";
  digest_id?: string;
  run_url?: string;
}

/** POST /api/narrate request body. */
export interface NarrateRequest {
  /** The digest to narrate, by id: "2026-10-07", "2026-10-07-2" or "2026-10-11-weekly". */
  digest: string;
  /** The same passphrase the Generate sheet asks for. */
  passphrase: string;
  /**
   * Narrate only this segment: a `key` from the lookup's `segments`. Leave it out to narrate the
   * whole digest as one file.
   */
  segment?: string;
}

/**
 * Where each story and section starts inside a whole-digest narration. To show it, patch
 * PlayerDigestData: `kind` goes into `timeline`, and the times go onto the items and sections with
 * the same `id` and `slug`.
 */
export interface NarrationTimeline {
  /** How the times were derived: word marks from the voice, or an estimate from text length. */
  kind: "marks" | "estimated";
  items: { id: string; section: Section; start_ms: number; end_ms: number }[];
  sections: { slug: Section; start_ms: number }[];
}

/**
 * One stretch of a digest's narration, stored as its own file so playback can start with the first
 * one. In order they are a track list: the intro, one per story, and an outro if the narration has a
 * closing line. A section's announcement is read at the start of that section's first story.
 */
export interface NarrationSegment {
  /** "intro", a story's item id, or "outro". Send it back as `segment` to narrate it. */
  key: string;
  /** The story this segment reads, or null for the intro and the outro. */
  item_id: string | null;
  /** Length of the spoken text. Times `ms_per_character` it estimates a duration before the audio exists. */
  characters: number;
  /**
   * The file, once this segment is narrated; null until then. The URL changes when the story's text
   * changes, so never build it: read it from here.
   */
  audio: { url: string; duration_ms: number } | null;
}

/**
 * Every refusal /api/narrate can answer with, for GET and POST alike. `status` repeats the HTTP
 * status. Treat any answer that is not in these unions (a 405, or a platform timeout page that is
 * not JSON) as "unavailable".
 */
export type NarrateError =
  // No digest id, a malformed id, segment key or body, or a request from another origin.
  | { status: 400; error: "invalid_request" }
  | { status: 401; error: "wrong_passphrase" }
  // This deployment has no such digest, or the digest has no segment with that key (the page's list
  // is out of date: ask GET again).
  | { status: 404; error: "digest_not_found" | "segment_not_found" }
  // Whole digest only: another request is narrating it right now. Ask GET again after `retry_after_s`.
  | { status: 409; error: "in_progress"; retry_after_s: number }
  // The digest cannot be read aloud: nothing to say, or too long for one request. Do not retry.
  | { status: 422; error: "not_narratable" }
  // Too many digests narrated in 24 hours. A digest that already has any narration is not refused.
  | { status: 429; error: "daily_cap"; retry_after_s: number }
  // The month's voice allowance is used up. It resets with the calendar month.
  | { status: 429; error: "monthly_budget" }
  // The voice service failed, or the finished audio could not be stored. Trying again later is safe.
  | { status: 502; error: "synthesis_failed" | "storage_failed" }
  // The site is not configured for narration, or the audio store could not be reached.
  | { status: 503; error: "unavailable" }
  // The voice service took longer than the function allows.
  | { status: 504; error: "took_too_long" };

/** Every error code /api/narrate can answer with. */
export type NarrateErrorCode = NarrateError["error"];

/**
 * GET /api/narrate?digest=<id>: what narration a digest has. It needs no passphrase and spends
 * nothing. It answers 200 for every digest this deployment has, narrated or not.
 */
export type NarrateLookupResponse =
  | {
      status: 200;
      /** The whole digest as one file, or null when it was never narrated that way. */
      audio: { url: string; duration_ms: number } | null;
      /** The timeline of that one file; null exactly when `audio` is. */
      timeline: NarrationTimeline | null;
      /** Every segment in playing order, each with its file once it exists. */
      segments: NarrationSegment[];
      /** An estimate of the voice's pace, for laying out segments that have no audio yet. */
      ms_per_character: number;
    }
  | NarrateError;

/**
 * POST /api/narrate without `segment`: narrates the whole digest as one file and answers with it.
 * When that file already exists it answers 200 without narrating again. It takes as long as the
 * voice service does, so show progress and never retry it on a timer.
 */
export type NarrateResponse =
  | { status: 200; audio: { url: string; duration_ms: number }; timeline: NarrationTimeline }
  | NarrateError;

/**
 * POST /api/narrate with `segment`: narrates that one segment and answers with it, `audio` filled
 * in. A segment that is already narrated is returned as it is and nothing is spent. Send one segment
 * at a time.
 */
export type NarrateSegmentResponse =
  | {
      status: 200;
      segment: NarrationSegment & { audio: { url: string; duration_ms: number } };
    }
  | NarrateError;
