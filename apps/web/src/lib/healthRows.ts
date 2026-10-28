/**
 * What the Health page (/settings/health) lists, in its order. The page draws every row from this at
 * build time, so its labels and its height are there before /api/health answers; the route fills
 * each row's value, line and tone by id (server/health.ts). A row whose id the answer lacks keeps
 * "No data".
 */

/** A judged row: good, worth a look, wrong. `none` is a reading with no judgement, and draws no dot. */
export type HealthTone = "good" | "warn" | "bad" | "none";

export interface HealthRow {
  id: string;
  value: string;
  detail: string;
  tone: HealthTone;
}

export interface HealthBody {
  checked_at: string;
  /** How many rows are `warn` or `bad`, and the worst of them. */
  attention: { count: number; tone: HealthTone };
  tiles: Record<HealthTileId, string>;
  rows: HealthRow[];
  /** Which upstreams answered: a part that did not is named in the page's note. */
  parts: {
    content: "ok" | "fallback";
    database: "ok" | "unavailable" | "off";
    /** `partial`: GitHub answered for some workflows, not all. */
    github: "ok" | "partial" | "unavailable" | "off";
  };
}

export const HEALTH_TILES = [
  { id: "last_briefing", label: "Last briefing" },
  { id: "briefing_time", label: "Briefing time" },
  { id: "page_load", label: "Page load" },
  { id: "errors_today", label: "Errors today" },
] as const;
export type HealthTileId = (typeof HEALTH_TILES)[number]["id"];

/** The device classes field vitals are kept by (core/vitals.ts), as the Speed card's select names them. */
export const HEALTH_DEVICES = [
  { id: "mobile", label: "Phones" },
  { id: "desktop", label: "Desktop" },
] as const;

/** The Speed card's metrics; each row's id is `<metric>.<device>`. */
export const HEALTH_SPEED = [
  { id: "lcp", label: "Loading" },
  { id: "inp", label: "Response" },
  { id: "cls", label: "Stability" },
] as const;

export const HEALTH_GROUPS = [
  {
    id: "briefings",
    title: "Briefings",
    rows: [
      { id: "daily", label: "Daily" },
      { id: "weekly", label: "Weekly" },
      { id: "catch_up", label: "Catch up" },
      { id: "narration", label: "Narration" },
      { id: "fallbacks", label: "Model fallbacks" },
    ],
  },
  {
    id: "times",
    title: "Run times",
    rows: [
      { id: "time_daily", label: "Daily" },
      { id: "time_weekly", label: "Weekly" },
    ],
  },
  {
    id: "errors",
    title: "Errors",
    rows: [
      { id: "page_errors", label: "Page errors" },
      { id: "blocked_scripts", label: "Blocked scripts" },
      { id: "server_errors", label: "Server errors" },
      { id: "timeouts", label: "Timeouts" },
    ],
  },
  {
    id: "jobs",
    title: "Jobs",
    rows: [
      { id: "job_run", label: "Briefings" },
      { id: "job_podcast", label: "Catch up" },
      { id: "job_audio", label: "Narration" },
      { id: "job_content", label: "Content sync" },
      { id: "job_health", label: "Daily check" },
    ],
  },
  {
    id: "services",
    title: "Sources and services",
    rows: [
      { id: "sources", label: "Sources" },
      { id: "database", label: "Database" },
      { id: "content", label: "Content store" },
    ],
  },
] as const;

/** The workflow file each Jobs row reads from GitHub's run list. */
export const HEALTH_JOBS: Record<string, string> = {
  job_run: "run.yml",
  job_podcast: "podcast.yml",
  job_audio: "audio.yml",
  job_content: "content.yml",
  job_health: "health.yml",
};
