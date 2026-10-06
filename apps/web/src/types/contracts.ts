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
