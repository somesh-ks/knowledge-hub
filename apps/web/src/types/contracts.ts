import type { DigestKind } from "@dispatch/core";

/**
 * Contracts shared by the reader pages, the player island and the Generate sheet. Both the page
 * author and the player author build against these types; change them only together.
 */

export interface PlayerItem {
  id: string;
  headline: string;
  /** A section id: one of the built-in ones, or one that came with a topic the owner added. */
  section: string;
  source: string;
  /**
   * The story's source page, already checked to be http or https, or null when it is not safe to
   * link. Optional because a page cached before this field existed does not carry it.
   */
  url?: string | null;
  /** The story as the host says it, for the transcript of a briefing. Episodes carry a script instead. */
  text?: string;
  /** Start and end inside the MP3, or null while the digest has no audio. */
  start_ms: number | null;
  end_ms: number | null;
}

/**
 * One turn of an episode's script, in the order it is said. `key` is the narration segment that
 * speaks it (t<idx>), so the player can place it on the timeline once the narration is laid out.
 */
export interface PlayerTurn {
  key: string;
  speaker: "a" | "b";
  text: string;
  /** The story this turn is about, or null for a greeting, a link between stories or a sign-off. */
  item_id?: string | null;
  /** A name for the turn in the transcript, in place of a speaker's: a briefing's story headline. */
  title?: string;
  /** Start and end inside the narration, or null before it has been laid out. */
  start_ms: number | null;
  end_ms: number | null;
}

export interface PlayerSection {
  slug: string;
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
  /** An episode's script. Briefings have none. */
  turns?: PlayerTurn[];
  /** What the two voices of a discussion are called, when the episode stored the names. */
  hosts?: { a: string; b: string } | null;
  /** The voice ids an episode was asked for; null for a host means the default voice. */
  voices?: { a: string | null; b: string | null };
  /** An episode's format, as the Library names it. Briefings have none. */
  format?: "readout" | "discussion" | "headlines";
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
  /** Regenerate: what to improve, up to 500 characters, passed to the writer. */
  feedback?: string;
  /** Regenerate a briefing that exists: its digest id. The new digest replaces it. */
  replace?: string;
  /** Delete a briefing: with `id`, no feedback and no run of the writer. */
  action?: "delete";
  id?: string;
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
  /** Where the run is in its stages (lib/runStages.ts): zero-based index, how many, and its name. */
  stage?: number;
  stages?: number;
  label?: string;
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
  items: { id: string; section: string; start_ms: number; end_ms: number }[];
  sections: { slug: string; start_ms: number }[];
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
   * Where this segment's file is. The URL changes when the story's text or the voice changes, so
   * never build it: read it from here.
   *
   * In a lookup, `confirmed` is false: the URL is where the file WOULD be, worked out without asking
   * the store, and `duration_ms` is a guess from the length of the text. Try the URL; when it is not
   * there (a 404), POST this segment's `key` to have it narrated. It is null only when the site
   * cannot work the address out, and then POST is the only way to get the file.
   *
   * In the answer to a POST, `confirmed` is true: the file exists. `duration_ms` is what the voice
   * service reported when the segment was just narrated, or worked out from the file's size when it
   * already existed. Either way, once the audio element has loaded the file, take the duration from
   * the element.
   */
  audio: { url: string; duration_ms: number; confirmed: boolean } | null;
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
  // Too many digests were first narrated today (a Stockholm day; `retry_after_s` runs to midnight
  // there). A digest that was already narrated this month, in part or whole, is never refused.
  | { status: 429; error: "daily_cap"; retry_after_s: number }
  // The month's voice allowance has no room for this digest. A digest is charged whole the first
  // time any part of it is narrated, and again after a failed attempt or a change of voice. It
  // resets with the calendar month.
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
 * GET /api/narrate?digest=<id>: the segments of a digest and where their audio would be. It needs no
 * passphrase, never narrates, and never asks the audio store anything, so it cannot say which
 * segments exist: see `NarrationSegment.audio`. `digest` is the only query parameter it accepts;
 * any other is a 400. It answers 200 for every digest this deployment has, and that answer may be
 * cached for a minute.
 */
export type NarrateLookupResponse =
  | {
      status: 200;
      /**
       * The whole digest as one file, when the site was built with one: a narration the audio
       * workflow committed. One made later by a POST without `segment` does not show here until
       * the next build.
       */
      audio: { url: string; duration_ms: number } | null;
      /** The timeline of that one file; null exactly when `audio` is. */
      timeline: NarrationTimeline | null;
      /** Every segment in playing order, each with the address its file would have. */
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
 * in and confirmed. A segment that is already narrated is returned as it is, and no voice characters
 * are spent on it. Send one segment at a time.
 */
export type NarrateSegmentResponse =
  | {
      status: 200;
      segment: NarrationSegment & {
        audio: { url: string; duration_ms: number; confirmed: true };
      };
    }
  | NarrateError;

/**
 * POST /api/config: one edit to the topics or the sources, or several that belong together (a new
 * topic and the sources chosen for it) in one request. The site is static and the settings live
 * in the repository, so the function checks the passphrase and dispatches the config workflow,
 * which commits the change. The change shows on the site after the next build.
 */
export type ConfigOp =
  | {
      op: "topic.upsert";
      topic: {
        id: string;
        name: string;
        description: string;
        weight: number;
        enabled: boolean;
        keywords: string[];
        section_id: string;
      };
    }
  | { op: "topic.remove"; id: string }
  | { op: "source.add"; url: string; topic_ids?: string[] }
  | { op: "source.set"; id: string; enabled?: boolean; pinned?: boolean }
  | {
      op: "source.update";
      id: string;
      /** A new name, 1 to 80 characters once trimmed. */
      name?: string;
      /**
       * Every topic the source feeds, custom or built-in, up to 12; an empty list files it under
       * Other. At least one of `name` and `topic_ids` is required.
       */
      topic_ids?: string[];
    }
  | { op: "source.remove"; id: string }
  | { op: "weights.set"; weights: Record<string, number> }
  | {
      op: "schedule.set";
      /** Any subset of these; a field left out keeps what the file holds. At least one is required. */
      /** IANA name of the schedule's clock, one of SUPPORTED_TIMEZONES. */
      timezone?: string;
      /** Whole hour in the schedule's time zone, 0 to 23. */
      hour?: number;
      /** Days between briefings: 1, 2, 3 or 7. */
      cadence_days?: 1 | 2 | 3 | 7;
      /** Topic ids the daily briefing leaves out. */
      skip_topics?: string[];
      /** Podcast type of the daily briefing. */
      format?: PodcastRequest["format"];
      /** Minutes the daily podcast runs. */
      length_minutes?: PodcastRequest["length_minutes"];
      /** Speechify voice ids of the daily podcast; null means the engine's default. */
      voice_id?: string | null;
      voice_id_b?: string | null;
      /** The weekly podcast. Fields left out keep what the file holds. */
      weekly?: {
        enabled?: boolean;
        /** Day of the week in Stockholm time, 0 = Sunday. */
        day?: number;
        hour?: number;
        /** Topic ids the weekly podcast leaves out. */
        skip_topics?: string[];
        format?: "readout" | "discussion";
        length_minutes?: PodcastRequest["length_minutes"];
        voice_id?: string | null;
        voice_id_b?: string | null;
      };
      /** What the Create panel starts from. */
      custom?: {
        /** Topic ids the Create panel does not offer (out of the Custom scope). */
        skip_topics?: string[];
        format?: "readout" | "discussion";
        length_minutes?: PodcastRequest["length_minutes"];
        voice_id?: string | null;
        voice_id_b?: string | null;
      };
    }
  | {
      /**
       * Where topics play (D69): each scope given puts the topics in (true) or out (false) of the
       * daily podcast, the weekly one and the Create panel, editing the lists in place. At least one
       * scope is required.
       */
      op: "topic.scope";
      ids: string[];
      daily?: boolean;
      weekly?: boolean;
      custom?: boolean;
    }
  | {
      op: "writer.set";
      provider: "nebius" | "anthropic";
      /** A Nebius model id or null for the engine's own setting; Anthropic needs one of its two ids. */
      model: string | null;
    }
  /** Block or unblock an outlet by domain; a blocked domain's subdomains are blocked with it. */
  | { op: "profile.block"; domain: string }
  | { op: "profile.unblock"; domain: string }
  | {
      /**
       * Mirrors the engine's profile.vote op (1 to 50 votes). A client sends one when the listener
       * rates a story; `clear` takes a vote back.
       */
      op: "profile.vote";
      votes: ProfileVote[];
    };

/** One vote on a story, as profile.vote carries it. */
export interface ProfileVote {
  story_id: string;
  url: string;
  /** At most 200 characters. */
  headline: string;
  topic: string;
  source_id: string;
  value: "up" | "down" | "clear";
  /** ISO time string. */
  at: string;
}

export interface ConfigRequest {
  passphrase: string;
  /** One edit, or up to 8 that are applied together, in order. */
  op: ConfigOp | ConfigOp[];
}

export type ConfigResponse =
  | {
      status: 202;
      run_id?: number;
      /**
       * Only for an edit that carried schedule.set: false when the site could not change the
       * briefing time (its GitHub token may lack permission to write repository variables). The
       * rest of the edit is saved either way.
       */
      time_changed?: boolean;
    }
  | { status: 400; error: "invalid_request" }
  | { status: 401; error: "wrong_passphrase" }
  | { status: 429; error: "cooldown"; retry_after_s: number }
  | { status: 503; error: "unavailable" };

/**
 * Podcast episodes. These mirror packages/core/src/podcast.ts; they are declared here so the page
 * scripts never pull the engine's schemas into the browser. Keep the two in step.
 */
export interface PodcastRequest {
  /** Section ids the episode draws on. One to six. Never "top": the engine always adds the top picks. */
  topic_ids: string[];
  /**
   * Who the script is written for. "general" explains terms and leaves out insider shorthand;
   * "custom" is written for the owner, a design engineer. Absent means "custom".
   */
  audience?: "general" | "custom";
  length_minutes: 3 | 5 | 10 | 15;
  /** New requests take "readout" or "discussion"; a stored episode may still say "headlines". */
  format: "readout" | "discussion" | "headlines";
  /** Speechify voice id of the lead host, speaker "a"; absent means the engine's default. */
  voice_id?: string | null;
  /** Voice id of the second host, speaker "b" (discussion only); absent means the default. */
  voice_id_b?: string | null;
  /**
   * The hosts' spoken names in a discussion, "a" the lead and "b" the second host. Only the server
   * sets them, from the voices' genders (hostNamesFor in core); a name a browser sends is dropped.
   * An episode stores the names it was written with. A discussion stored without them predates the
   * field and was written with Ada and Leo; a readout names no host.
   */
  host_names?: { a: string; b: string };
  /** How many days of stories to draw on. */
  window_days: 2 | 7 | 30;
  tone: "neutral" | "energetic";
  title?: string;
}

/** POST /api/podcast request body. */
export interface PodcastCreateRequest {
  passphrase: string;
  request: PodcastRequest;
}

/** POST /api/podcast with an action: delete an episode, or write it again with feedback. */
export type PodcastActionRequest =
  | { passphrase: string; action: "delete"; id: string }
  | { passphrase: string; action: "regenerate"; id: string; feedback: string };

/** POST /api/podcast responses. */
export type PodcastCreateResponse =
  | { status: 202; run_id: number; started_at: string }
  | { status: 400; error: "invalid_request" }
  | { status: 401; error: "wrong_passphrase" }
  | { status: 429; error: "cooldown" | "daily_cap"; retry_after_s: number }
  | { status: 503; error: "unavailable" };
