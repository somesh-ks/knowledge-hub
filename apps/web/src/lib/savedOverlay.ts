/**
 * Saved, but not live yet. A settings edit is in the repository a few seconds after it is sent, and
 * on the site only after the config workflow and the next build, about a minute later. The pages are
 * static, so a settings page opened in that minute is built with the old value and the change looks
 * lost. Each edit that went through is kept here, with when it went (managePageSave.ts); a settings
 * page opened within SAVED_TTL_MS shows the saved value in place of the one it was built with
 * (scripts/savedView.ts). Once the page is built with the saved value, the build has landed and
 * there is nothing to show.
 *
 * The writer's provider and model keep their own note (PENDING_WRITER_KEY in podcastPage.ts), so a
 * writer.set is not kept here.
 *
 * Pure: the caller reads and writes storage.
 */
import type { ConfigOp } from "../types/contracts";

/** How long a saved edit is shown over the page it was built with: the build takes about a minute. */
export const SAVED_TTL_MS = 3 * 60 * 1000;

/** One request that went through: its edits, and when, in epoch milliseconds. */
export interface SavedEntry {
  at: number;
  ops: ConfigOp[];
}

const isOp = (value: unknown): value is ConfigOp =>
  typeof value === "object" && value !== null && typeof (value as { op?: unknown }).op === "string";

/** Kept for SAVED_TTL_MS, and never from the future: a clock moved back drops it. */
const fresh = (at: number, now: number): boolean => at <= now && now - at < SAVED_TTL_MS;

/** The entries in what storage holds that are still shown, oldest first. Anything malformed is none. */
export function parseSaved(raw: string | null, now: number): SavedEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      const { at, ops } = (entry ?? {}) as { at?: unknown; ops?: unknown };
      if (typeof at !== "number" || !Array.isArray(ops) || !fresh(at, now)) return [];
      return [{ at, ops: ops.filter(isOp) }];
    });
  } catch {
    return [];
  }
}

/** The entries with a request just saved added last; those too old to show are dropped. */
export function addSaved(
  entries: readonly SavedEntry[],
  ops: readonly ConfigOp[],
  now: number,
): SavedEntry[] {
  const kept = entries.filter((entry) => fresh(entry.at, now));
  const own = ops.filter((op) => op.op !== "writer.set");
  return own.length > 0 ? [...kept, { at: now, ops: own }] : kept;
}

/** Every edit still shown, in the order it was saved, so a later one overrides an earlier one. */
export function savedOps(entries: readonly SavedEntry[], now: number): ConfigOp[] {
  return entries.filter((entry) => fresh(entry.at, now)).flatMap((entry) => entry.ops);
}

// ------------------------------------------------------------------------------------- podcast pages

/** What a podcast page's schedule controls hold, by field: "daily.hour", "weekly.enabled". */
export type FieldValues = Record<string, string>;

/** A field of schedule.set by the name its control goes by (scheduleOp in podcastProfiles.ts). */
const CONTROL_NAMES: Record<string, string> = {
  cadence_days: "cadence",
  length_minutes: "length",
  voice_id: "voice",
  voice_id_b: "voice_b",
};

/** A value as a control holds it: null is Default, the empty choice. Lists are not controls. */
function asControl(value: unknown): string | null {
  if (value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  return null;
}

/**
 * The schedule controls whose saved value differs from what the page was built with: each schedule.set
 * laid over `baked` in turn. Empty when nothing was saved, or when the build has landed.
 */
export function savedFields(baked: FieldValues, ops: readonly ConfigOp[]): FieldValues {
  const saved: FieldValues = {};
  const put = (profile: string, name: string, value: unknown): void => {
    const text = asControl(value);
    if (text === null) return;
    const field = CONTROL_NAMES[name] ?? name;
    for (const key of Object.keys(baked)) {
      const [owner = "", own = ""] = key.includes(".") ? key.split(".") : ["", key];
      if (own === field && owner === profile) saved[key] = text;
    }
  };
  for (const op of ops) {
    if (op.op !== "schedule.set") continue;
    for (const [name, value] of Object.entries(op)) {
      if (name === "op") continue;
      if ((name === "weekly" || name === "custom") && value && typeof value === "object") {
        for (const [inner, each] of Object.entries(value)) put(name, inner, each);
      } else put("daily", name, value);
    }
  }
  return Object.fromEntries(Object.entries(saved).filter(([key, value]) => baked[key] !== value));
}

/**
 * Whether a set of topics was last saved in a podcast (`profile`), or undefined when no saved edit
 * says. An edit counts when it covers every one of the topics.
 */
export function savedScope(
  ops: readonly ConfigOp[],
  profile: string,
  ids: readonly string[],
): boolean | undefined {
  let found: boolean | undefined;
  for (const op of ops) {
    if (op.op !== "topic.scope" || ids.length === 0) continue;
    const value = (op as Record<string, unknown>)[profile];
    if (typeof value === "boolean" && ids.every((id) => op.ids.includes(id))) found = value;
  }
  return found;
}

// -------------------------------------------------------------------------------------- topic pages

/**
 * What a topics control was last saved as, as the editor reads a control ("true", "0.75"), or
 * undefined when no saved edit says. `op` and `field` are the control's data-op and data-field.
 */
export function savedControl(
  ops: readonly ConfigOp[],
  op: ConfigOp,
  field: string,
): string | undefined {
  let found: string | undefined;
  const [outer = "", inner = ""] = field.split(".");
  for (const saved of ops) {
    if (op.op === "source.set" && saved.op === "source.set" && saved.id === op.id) {
      const value = (saved as Record<string, unknown>)[field];
      if (typeof value === "boolean") found = String(value);
    } else if (op.op === "weights.set" && saved.op === "weights.set" && outer === "weights") {
      const value = saved.weights[inner];
      if (typeof value === "number") found = String(value);
    } else if (
      op.op === "topic.upsert" &&
      saved.op === "topic.upsert" &&
      saved.topic.id === op.topic.id &&
      field === "topic.enabled"
    ) {
      found = String(saved.topic.enabled);
    }
  }
  if (op.op === "topic.scope") {
    const scope = savedScope(ops, field, op.ids);
    if (scope !== undefined) found = String(scope);
  }
  return found;
}

type Upsert = Extract<ConfigOp, { op: "topic.upsert" }>["topic"];

/** What the saved edits did to topics and sources, latest last: a removal undone by an add is not one. */
export interface SavedTopics {
  /** Each topic's details as last saved: a new topic, or a new name and what counts. */
  topics: Map<string, Upsert>;
  /** Topic ids removed. */
  removedTopics: Set<string>;
  /** Source ids removed. */
  removedSources: Set<string>;
  /** Each source's new name and topics, merged across edits. */
  sources: Map<string, { name?: string; topic_ids?: string[] }>;
  /** Feeds added, by address. */
  feeds: Set<string>;
}

export function savedTopics(ops: readonly ConfigOp[]): SavedTopics {
  const out: SavedTopics = {
    topics: new Map(),
    removedTopics: new Set(),
    removedSources: new Set(),
    sources: new Map(),
    feeds: new Set(),
  };
  for (const op of ops) {
    if (op.op === "topic.upsert") {
      out.topics.set(op.topic.id, op.topic);
      out.removedTopics.delete(op.topic.id);
    } else if (op.op === "topic.remove") {
      out.removedTopics.add(op.id);
      out.topics.delete(op.id);
    } else if (op.op === "source.remove") out.removedSources.add(op.id);
    else if (op.op === "source.add") out.feeds.add(op.url);
    else if (op.op === "source.update") {
      const { op: _, id, ...edit } = op;
      out.sources.set(id, { ...out.sources.get(id), ...edit });
    }
  }
  return out;
}
