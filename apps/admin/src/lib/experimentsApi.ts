import { EXPERIMENTS } from "./experiments.js";

/**
 * What the Experiments page asks of its function (api/experiments.ts): the owner's switches as the
 * store holds them, and a write for one. The handler takes the store as `deps`, so a test drives it
 * without Neon.
 */
export const ACTIONS = ["on", "off", "promote", "unpromote"] as const;
export type ExperimentAction = (typeof ACTIONS)[number];

/** One stored switch, as the engine keeps it (store/experimentFlags.ts). */
export interface FlagRow {
  id: string;
  enabled: boolean;
  promoted_at: number | null;
}

/** What an experiment in shadow would have added over the window (store/experimentHits.ts). */
export interface HitTotal {
  stories: number;
  passes: number;
}

export interface ExperimentStore {
  read(): Promise<FlagRow[]>;
  /** The shadow counts by experiment id; none for an experiment that has not run in shadow. */
  hits(): Promise<Record<string, HitTotal>>;
  /** False when the store refused: a promoted experiment stays on (D249). */
  setEnabled(id: string, enabled: boolean): Promise<boolean>;
  setPromoted(id: string, promoted: boolean): Promise<void>;
}

export interface ApiRequest {
  method: string;
  contentType: string | null;
  bodyText: string;
}

export interface ApiAnswer {
  status: number;
  body: unknown;
}

/** The ones with a flag the engine reads; an experiment with none (ingest) has no switch to write. */
const SWITCHED = new Set(EXPERIMENTS.filter((experiment) => experiment.flag).map((e) => e.id));

const MAX_BODY_CHARS = 512;

export async function handleExperiments(
  request: ApiRequest,
  store: ExperimentStore | null,
): Promise<ApiAnswer> {
  if (request.method !== "GET" && request.method !== "POST") {
    return { status: 405, body: { error: "method_not_allowed" } };
  }
  if (store === null) return { status: 503, body: { error: "no_store" } };
  if (request.method === "GET") {
    // The counts are an extra: a store that cannot give them still gives the switches.
    const hits = await store.hits().catch(() => ({}));
    return { status: 200, body: { flags: await store.read(), hits } };
  }

  // JSON is what a page sends and what a form on another site cannot: it makes the browser ask
  // first (the session cookie is SameSite=Lax besides).
  if (!request.contentType?.toLowerCase().startsWith("application/json")) {
    return { status: 415, body: { error: "json_only" } };
  }
  const asked = parse(request.bodyText);
  if (asked === null || !SWITCHED.has(asked.id)) {
    return { status: 400, body: { error: "bad_request" } };
  }
  if (asked.action === "on" || asked.action === "off") {
    if (!(await store.setEnabled(asked.id, asked.action === "on"))) {
      return { status: 409, body: { error: "promoted", flags: await store.read() } };
    }
  } else await store.setPromoted(asked.id, asked.action === "promote");
  return { status: 200, body: { flags: await store.read() } };
}

function parse(text: string): { id: string; action: ExperimentAction } | null {
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    const { id, action } = JSON.parse(text) as { id?: unknown; action?: unknown };
    if (typeof id !== "string" || !ACTIONS.includes(action as ExperimentAction)) return null;
    return { id, action: action as ExperimentAction };
  } catch {
    return null;
  }
}
