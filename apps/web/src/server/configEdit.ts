import {
  isAnthropicModel,
  MODEL_ID_PATTERN,
  PODCAST_FORMATS,
  SCHEDULE_LENGTHS,
} from "@dispatch/core";
import type { ConfigOp, ConfigResponse, PodcastRequest } from "../types/contracts";
import { readServerConfig, secretsOf } from "./config";
import {
  type GenerateDeps,
  isSameOrigin,
  MAX_PASSPHRASE_CHARS,
  WRONG_PASSPHRASE_DELAY_MS,
} from "./generate";
import {
  CONFIG_WORKFLOW_FILE,
  createVariableWriter,
  createWorkflowDispatcher,
  RUN_CRON_VARIABLE,
} from "./github";
import type { ApiResult } from "./http";
import { describeError } from "./redact";

/**
 * POST /api/config: check the passphrase, check the cooldown against GitHub, dispatch config.yml with
 * the edit as its one input. Built like handleGenerate, and for the same reason: everything with a
 * side effect is a parameter, so the whole flow is tested with fakes and no network.
 *
 * The edit is validated by hand and rebuilt from the validated parts, so a field the contract does
 * not name never reaches the workflow.
 */

/** Edits are small. A weights map for a hundred topics is the largest valid body, near 6 KB. */
export const MAX_CONFIG_BODY_CHARS = 8192;
/** Two edits closer together than this are refused, so one person cannot flood the repository. */
export const CONFIG_COOLDOWN_MS = 10_000;

const RUN_LOOKUP_ATTEMPTS = 3;
const RUN_LOOKUP_DELAY_MS = 1500;

export type ConfigDeps = GenerateDeps;

export interface ConfigInput {
  bodyText: string;
  /** The request's Origin header, if the browser sent one. */
  origin: string | null;
  /** The origin the request was made to. */
  expectedOrigin: string;
}

type ConfigResult = ApiResult<ConfigResponse>;

const unavailable: ConfigResult = { status: 503, body: { status: 503, error: "unavailable" } };
const invalid: ConfigResult = { status: 400, body: { status: 400, error: "invalid_request" } };

// ---------------------------------------------------------------------------------------- validation

const ID = /^[a-z0-9_-]{2,40}$/;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 400;
const MAX_KEYWORDS = 12;
const MAX_KEYWORD = 40;
const MAX_URL = 2048;
const MAX_TOPIC_IDS = 12;
const MAX_WEIGHTS = 100;
const MAX_SECTIONS = 60;
const CADENCES = [1, 2, 3, 7] as const;
type PodcastFormat = PodcastRequest["format"];
type PodcastLength = PodcastRequest["length_minutes"];
/** A new topic and the sources chosen for it: one topic, up to six sources, and room to spare. */
export const MAX_OPS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Control characters have no place in a name or an address, and a line break could forge a log line. */
function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** A trimmed string of 1 to `max` characters with no control characters, or null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max || hasControl(trimmed)) return null;
  return trimmed;
}

function id(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

function weight(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/** An address a feed can be read from: http or https, with a host, and nothing in the userinfo slot. */
function webUrl(value: unknown): string | null {
  const address = text(value, MAX_URL);
  if (address === null) return null;
  try {
    const parsed = new URL(address);
    const isWeb = parsed.protocol === "http:" || parsed.protocol === "https:";
    if (!isWeb || parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function keywords(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_KEYWORDS) return null;
  const result: string[] = [];
  for (const entry of value) {
    const keyword = text(entry, MAX_KEYWORD);
    if (keyword === null) return null;
    result.push(keyword);
  }
  return result;
}

function topicIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_TOPIC_IDS) return null;
  const result: string[] = [];
  for (const entry of value) {
    const topic = id(entry);
    if (topic === null) return null;
    result.push(topic);
  }
  return result;
}

/** The edit as the contract defines it, rebuilt from validated parts, or null when it is not valid. */
export function parseConfigOp(value: unknown): ConfigOp | null {
  if (!isRecord(value)) return null;
  switch (value.op) {
    case "topic.upsert": {
      const topic = isRecord(value.topic) ? value.topic : null;
      if (!topic) return null;
      const topicId = id(topic.id);
      const name = text(topic.name, MAX_NAME);
      const description = text(topic.description, MAX_DESCRIPTION);
      const amount = weight(topic.weight);
      const enabled = typeof topic.enabled === "boolean" ? topic.enabled : null;
      const words = keywords(topic.keywords);
      const sectionId = id(topic.section_id);
      if (
        topicId === null ||
        name === null ||
        description === null ||
        amount === null ||
        enabled === null ||
        words === null ||
        sectionId === null
      ) {
        return null;
      }
      return {
        op: "topic.upsert",
        topic: {
          id: topicId,
          name,
          description,
          weight: amount,
          enabled,
          keywords: words,
          section_id: sectionId,
        },
      };
    }
    case "topic.remove": {
      const topic = id(value.id);
      return topic === null ? null : { op: "topic.remove", id: topic };
    }
    case "source.add": {
      const url = webUrl(value.url);
      if (url === null) return null;
      if (value.topic_ids === undefined) return { op: "source.add", url };
      const ids = topicIds(value.topic_ids);
      return ids === null ? null : { op: "source.add", url, topic_ids: ids };
    }
    case "source.set": {
      const source = id(value.id);
      if (source === null) return null;
      const enabled = value.enabled;
      const pinned = value.pinned;
      if (enabled !== undefined && typeof enabled !== "boolean") return null;
      if (pinned !== undefined && typeof pinned !== "boolean") return null;
      // An edit that changes nothing is a mistake, not a request.
      if (enabled === undefined && pinned === undefined) return null;
      return {
        op: "source.set",
        id: source,
        ...(enabled === undefined ? {} : { enabled }),
        ...(pinned === undefined ? {} : { pinned }),
      };
    }
    case "source.remove": {
      const source = id(value.id);
      return source === null ? null : { op: "source.remove", id: source };
    }
    case "weights.set": {
      if (!isRecord(value.weights)) return null;
      const entries = Object.entries(value.weights);
      if (entries.length === 0 || entries.length > MAX_WEIGHTS) return null;
      const weights: Record<string, number> = {};
      for (const [key, amount] of entries) {
        const topic = id(key);
        const checked = weight(amount);
        if (topic === null || checked === null) return null;
        weights[topic] = checked;
      }
      return { op: "weights.set", weights };
    }
    case "schedule.set": {
      const { hour, cadence_days: cadence } = value;
      if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
      const cadenceDays = CADENCES.find((days) => days === cadence);
      if (cadenceDays === undefined) return null;
      const podcast: { format?: PodcastFormat; length_minutes?: PodcastLength } = {};
      if (value.format !== undefined) {
        const format = PODCAST_FORMATS.find((entry) => entry === value.format);
        if (format === undefined) return null;
        podcast.format = format;
      }
      if (value.length_minutes !== undefined) {
        const length = SCHEDULE_LENGTHS.find((minutes) => minutes === value.length_minutes);
        if (length === undefined) return null;
        podcast.length_minutes = length;
      }
      if (value.sections === null) {
        return { op: "schedule.set", hour, cadence_days: cadenceDays, sections: null, ...podcast };
      }
      if (!Array.isArray(value.sections)) return null;
      if (value.sections.length === 0 || value.sections.length > MAX_SECTIONS) return null;
      const sections: string[] = [];
      for (const entry of value.sections) {
        const section = id(entry);
        if (section === null) return null;
        sections.push(section);
      }
      return { op: "schedule.set", hour, cadence_days: cadenceDays, sections, ...podcast };
    }
    case "writer.set": {
      if (value.provider === "anthropic") {
        if (typeof value.model !== "string" || !isAnthropicModel(value.model)) return null;
        return { op: "writer.set", provider: "anthropic", model: value.model };
      }
      if (value.provider !== "nebius") return null;
      if (value.model === null) return { op: "writer.set", provider: "nebius", model: null };
      if (typeof value.model !== "string" || !MODEL_ID_PATTERN.test(value.model)) return null;
      if (value.model.startsWith("claude-")) return null;
      return { op: "writer.set", provider: "nebius", model: value.model };
    }
    default:
      return null;
  }
}

/**
 * The hour of the last schedule.set in an edit, or null when it holds none. The last one wins,
 * as it does when the engine applies them in order.
 */
function scheduledHour(op: ConfigOp | ConfigOp[]): number | null {
  let hour: number | null = null;
  for (const entry of Array.isArray(op) ? op : [op]) {
    if (entry.op === "schedule.set") hour = entry.hour;
  }
  return hour;
}

/**
 * Pulls the passphrase and the edit out of a JSON body, or null when the body is not valid. `op` is
 * one edit, or a list of 1 to 8 that are applied together; one bad entry refuses the whole list.
 */
export function parseConfigRequest(
  bodyText: string,
): { passphrase: string; op: ConfigOp | ConfigOp[] } | null {
  if (bodyText.length === 0 || bodyText.length > MAX_CONFIG_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const passphrase = parsed.passphrase;
  if (typeof passphrase !== "string") return null;
  if (passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_CHARS) return null;
  if (Array.isArray(parsed.op)) {
    if (parsed.op.length === 0 || parsed.op.length > MAX_OPS) return null;
    const ops = parsed.op.map(parseConfigOp);
    return ops.every((op): op is ConfigOp => op !== null) ? { passphrase, op: ops } : null;
  }
  const op = parseConfigOp(parsed.op);
  return op === null ? null : { passphrase, op };
}

// ------------------------------------------------------------------------------------------ cooldown

/**
 * Seconds to wait before the next edit, or 0 when one may go now. `startedAt` is each config run's
 * start in epoch milliseconds, newest or not. Like the Generate limits, it counts every run of the
 * workflow whoever started it, so the function keeps no state of its own.
 */
export function configCooldownSeconds(startedAt: readonly number[], now: number): number {
  const newest = Math.max(0, ...startedAt.filter((time) => time <= now + 5000));
  const remaining = newest + CONFIG_COOLDOWN_MS - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// -------------------------------------------------------------------------------------------- handler

export async function handleConfig(input: ConfigInput, deps: ConfigDeps): Promise<ConfigResult> {
  const config = readServerConfig(deps.env);
  const log = deps.log ?? (() => {});
  if (!config) return unavailable;

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const request = parseConfigRequest(input.bodyText);
  if (request === null) return invalid;

  const isValid = await deps.verifyPassphrase(request.passphrase, config.passphraseHash);
  if (!isValid) {
    await deps.delay(WRONG_PASSPHRASE_DELAY_MS);
    return { status: 401, body: { status: 401, error: "wrong_passphrase" } };
  }

  const github = createWorkflowDispatcher(config, deps.fetch, CONFIG_WORKFLOW_FILE);
  try {
    const runs = await github.listDispatchRuns();
    const started = runs.map((run) => Date.parse(run.createdAt)).filter(Number.isFinite);
    const wait = configCooldownSeconds(started, deps.now());
    if (wait > 0) {
      return {
        status: 429,
        headers: { "Retry-After": String(wait) },
        body: { status: 429, error: "cooldown", retry_after_s: wait },
      };
    }

    const startedAt = deps.now();
    // One edit goes as it always did, an object; several go as an array in the same input.
    const edit = Array.isArray(request.op) && request.op.length === 1 ? request.op[0] : request.op;
    let runId = await github.dispatch({ op: JSON.stringify(edit) });
    for (let attempt = 0; runId === null && attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
      // GitHub started the run but did not name it. The newest run created since the request is it.
      await deps.delay(RUN_LOOKUP_DELAY_MS);
      const after = await github.listDispatchRuns();
      runId =
        after.find((run) => Date.parse(run.createdAt) >= startedAt - 5000 && run.status !== "")
          ?.id ?? null;
    }
    if (runId === null) return unavailable;

    // The hour lives in a repository variable, which run.yml compares against its schedule. A
    // token without "Variables: write" is refused; the rest of the edit is already on its way.
    const hour = scheduledHour(request.op);
    if (hour === null) return { status: 202, body: { status: 202, run_id: runId } };
    let timeChanged = true;
    try {
      await createVariableWriter(config, deps.fetch)(RUN_CRON_VARIABLE, `13 ${hour} * * *`);
    } catch (error) {
      timeChanged = false;
      log(`run time not changed: ${describeError(error, secretsOf(config))}`);
    }
    return { status: 202, body: { status: 202, run_id: runId, time_changed: timeChanged } };
  } catch (error) {
    log(`config failed: ${describeError(error, secretsOf(config))}`);
    return unavailable;
  }
}
