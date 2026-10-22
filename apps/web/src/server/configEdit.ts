import {
  ConfigOp as CoreConfigOp,
  DEFAULT_SCHEDULE,
  isSupportedTimeZone,
  SCHEDULE_LENGTHS,
  ScheduleFile,
  SOURCE_FORMATS,
  scheduleZone,
} from "@dispatch/core";

import { configStoreUrl, type SqlClient } from "@dispatch/engine/config-paths";
import { blockedDomainOf } from "../lib/blockedOutlets";
import type { ConfigOp, ConfigResponse, PodcastRequest } from "../types/contracts";
import { missingSettings, readServerConfig, type ServerConfig, secretsOf } from "./config";
import { fallbackCronHour } from "./cron";
import { type GenerateDeps, isSameOrigin } from "./generate";
import {
  CONFIG_WORKFLOW_FILE,
  createGitHubClient,
  createVariableWriter,
  createWorkflowDispatcher,
  RUN_CRON_VARIABLE,
} from "./github";
import type { ApiResult } from "./http";
import { cooldownRefusal } from "./rateLimit";
import { describeError } from "./redact";

/**
 * POST /api/config: check the edit, check the cooldown against GitHub, dispatch config.yml with
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

const RUN_LOOKUP_ATTEMPTS = 1;
const RUN_LOOKUP_DELAY_MS = 500;

export interface ConfigDeps extends GenerateDeps {
  /** Opens the config store (D149). Tests pass a fake; left out, the Neon driver is used. */
  connectConfigStore?: (databaseUrl: string) => Promise<SqlClient>;
  /** Read-only files the edit is applied against besides the stored documents (the seed sources). */
  baseFiles?: Readonly<Record<string, string>>;
}

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
const MAX_SOURCE_NAME = 80;
const MAX_DESCRIPTION = 400;
const MAX_KEYWORDS = 12;
const MAX_KEYWORD = 40;
const MAX_URL = 2048;
const MAX_TOPIC_IDS = 12;
const MAX_WEIGHTS = 100;
const MAX_SKIPPED_TOPICS = 200;
const CADENCES = [1, 2, 3, 7] as const;
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

const NEW_FORMATS = ["readout", "discussion"] as const;
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
type ScheduleSetOp = Extract<ConfigOp, { op: "schedule.set" }>;
type WeeklyOp = NonNullable<ScheduleSetOp["weekly"]>;
type CustomOp = NonNullable<ScheduleSetOp["custom"]>;

/** A voice id, null for the default, undefined when left out, or false when it is something else. */
function voice(value: unknown): string | null | undefined | false {
  if (value === undefined || value === null) return value;
  return typeof value === "string" && VOICE_ID.test(value) ? value : false;
}

function hourOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : null;
}

function lengthOf(value: unknown): PodcastLength | null {
  return SCHEDULE_LENGTHS.find((minutes) => minutes === value) ?? null;
}

/** The part `weekly` and `custom` share: type, length and the two voices. False when one is invalid. */
function podcastParts(value: Record<string, unknown>, into: WeeklyOp | CustomOp): boolean {
  if (value.format !== undefined) {
    const format = NEW_FORMATS.find((entry) => entry === value.format);
    if (format === undefined) return false;
    into.format = format;
  }
  if (value.length_minutes !== undefined) {
    const length = lengthOf(value.length_minutes);
    if (length === null) return false;
    into.length_minutes = length;
  }
  for (const key of ["voice_id", "voice_id_b"] as const) {
    const checked = voice(value[key]);
    if (checked === false) return false;
    if (checked !== undefined) into[key] = checked;
  }
  return true;
}

/** Topic ids an episode leaves out, undefined when the field is absent, false when it is invalid. */
function skipOf(value: unknown): string[] | undefined | false {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_SKIPPED_TOPICS) return false;
  const topics: string[] = [];
  for (const entry of value) {
    const topic = id(entry);
    if (topic === null) return false;
    topics.push(topic);
  }
  return topics;
}

/** A `schedule.set` rebuilt from the fields it names: any subset, and at least one. */
function parseScheduleSet(value: Record<string, unknown>): ConfigOp | null {
  const op: ScheduleSetOp = { op: "schedule.set" };
  if (value.timezone !== undefined) {
    if (typeof value.timezone !== "string" || !isSupportedTimeZone(value.timezone)) return null;
    op.timezone = value.timezone;
  }
  if (value.hour !== undefined) {
    const hour = hourOf(value.hour);
    if (hour === null) return null;
    op.hour = hour;
  }
  if (value.cadence_days !== undefined) {
    const cadence = CADENCES.find((days) => days === value.cadence_days);
    if (cadence === undefined) return null;
    op.cadence_days = cadence;
  }
  const skip = skipOf(value.skip_topics);
  if (skip === false) return null;
  if (skip !== undefined) op.skip_topics = skip;
  if (value.length_minutes !== undefined) {
    const length = lengthOf(value.length_minutes);
    if (length === null) return null;
    op.length_minutes = length;
  }
  for (const key of ["voice_id", "voice_id_b"] as const) {
    const checked = voice(value[key]);
    if (checked === false) return null;
    if (checked !== undefined) op[key] = checked;
  }
  if (value.weekly !== undefined) {
    if (!isRecord(value.weekly)) return null;
    const weekly: WeeklyOp = {};
    if (value.weekly.enabled !== undefined) {
      if (typeof value.weekly.enabled !== "boolean") return null;
      weekly.enabled = value.weekly.enabled;
    }
    if (value.weekly.day !== undefined) {
      const day = value.weekly.day;
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) return null;
      weekly.day = day;
    }
    if (value.weekly.hour !== undefined) {
      const hour = hourOf(value.weekly.hour);
      if (hour === null) return null;
      weekly.hour = hour;
    }
    const weeklySkip = skipOf(value.weekly.skip_topics);
    if (weeklySkip === false) return null;
    if (weeklySkip !== undefined) weekly.skip_topics = weeklySkip;
    if (!podcastParts(value.weekly, weekly)) return null;
    op.weekly = weekly;
  }
  if (value.custom !== undefined) {
    if (!isRecord(value.custom)) return null;
    const custom: CustomOp = {};
    const customSkip = skipOf(value.custom.skip_topics);
    if (customSkip === false) return null;
    if (customSkip !== undefined) custom.skip_topics = customSkip;
    if (!podcastParts(value.custom, custom)) return null;
    op.custom = custom;
  }
  return Object.keys(op).length > 1 ? op : null;
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
      const emoji =
        topic.emoji === undefined
          ? undefined
          : typeof topic.emoji === "string" &&
              topic.emoji.trim() !== "" &&
              topic.emoji.trim().length <= 16
            ? topic.emoji.trim()
            : null;
      if (
        emoji === null ||
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
          ...(emoji === undefined ? {} : { emoji }),
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
    case "source.update": {
      const source = id(value.id);
      if (source === null) return null;
      const name = value.name === undefined ? undefined : text(value.name, MAX_SOURCE_NAME);
      const ids = value.topic_ids === undefined ? undefined : topicIds(value.topic_ids);
      if (name === null || ids === null) return null;
      // An edit that changes nothing is a mistake, not a request. An empty topic list is a change:
      // it files the source under Other.
      const lean =
        value.lean === null ||
        (typeof value.lean === "number" &&
          Number.isInteger(value.lean) &&
          Math.abs(value.lean) <= 2)
          ? value.lean
          : undefined;
      const format = SOURCE_FORMATS.find((entry) => entry === value.format);
      if (name === undefined && ids === undefined && lean === undefined && format === undefined) {
        return null;
      }
      return {
        op: "source.update",
        id: source,
        ...(name === undefined ? {} : { name }),
        ...(ids === undefined ? {} : { topic_ids: ids }),
        ...(lean === undefined ? {} : { lean }),
        ...(format === undefined ? {} : { format }),
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
    case "schedule.set":
      return parseScheduleSet(value);
    case "topic.scope": {
      const ids = skipOf(value.ids);
      if (ids === false || ids === undefined || ids.length === 0) return null;
      const scope: { daily?: boolean; weekly?: boolean; custom?: boolean } = {};
      for (const key of ["daily", "weekly", "custom"] as const) {
        const flag = value[key];
        if (flag === undefined) continue;
        if (typeof flag !== "boolean") return null;
        scope[key] = flag;
      }
      return Object.keys(scope).length > 0 ? { op: "topic.scope", ids, ...scope } : null;
    }
    case "profile.block":
    case "profile.unblock": {
      // Any address of the outlet is accepted and stored as its domain; what is not a host is refused.
      const domain = typeof value.domain === "string" ? blockedDomainOf(value.domain) : null;
      return domain === null ? null : { op: value.op, domain };
    }
    case "topic.mix":
    case "mix.set": {
      // The shape is core's (stops by factor), the same schema the engine applies the op with.
      const parsed = CoreConfigOp.safeParse(value);
      return parsed.success && parsed.data.op === value.op ? (value as ConfigOp) : null;
    }
    case "profile.vote": {
      // The vote shape is core's (VoteInput), the same schema the engine applies the op with.
      const parsed = CoreConfigOp.safeParse(value);
      return parsed.success && parsed.data.op === "profile.vote" ? parsed.data : null;
    }
    default:
      return null;
  }
}

/**
 * The daily hour of the last schedule.set that names one, or null when none does. The last one wins,
 * as it does when the engine applies them in order.
 */
export function scheduledTime(
  op: ConfigOp | ConfigOp[],
): { hour: number | undefined; timezone: string | undefined } | null {
  let hour: number | undefined;
  let timezone: string | undefined;
  for (const entry of Array.isArray(op) ? op : [op]) {
    if (entry.op !== "schedule.set") continue;
    if (entry.hour !== undefined) hour = entry.hour;
    if (entry.timezone !== undefined) timezone = entry.timezone;
  }
  return hour === undefined && timezone === undefined ? null : { hour, timezone };
}

/**
 * Pulls the edit out of a JSON body, or null when the body is not valid. `op` is one edit, or a
 * list of 1 to 8 that are applied together; one bad entry refuses the whole list. A `passphrase`
 * field that a page built before D157 still sends is ignored.
 */
export function parseConfigRequest(bodyText: string): { op: ConfigOp | ConfigOp[] } | null {
  if (bodyText.length === 0 || bodyText.length > MAX_CONFIG_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (Array.isArray(parsed.op)) {
    if (parsed.op.length === 0 || parsed.op.length > MAX_OPS) return null;
    const ops = parsed.op.map(parseConfigOp);
    return ops.every((op): op is ConfigOp => op !== null) ? { op: ops } : null;
  }
  const op = parseConfigOp(parsed.op);
  return op === null ? null : { op };
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

// -------------------------------------------------------------------------------------------- run time

/**
 * Move the repository variable run.yml compares against its schedule. The edit names the hour, the
 * zone or both; the other comes from the stored schedule. The variable is in Stockholm time (run.yml's
 * entries are), so the hour is moved there as of now. A token without "Variables: write" is refused;
 * the rest of the edit is saved either way, so this answers false instead of failing.
 */
export async function updateRunTime(
  config: ServerConfig,
  deps: ConfigDeps,
  time: { hour: number | undefined; timezone: string | undefined },
  readSchedule: () => Promise<string | null>,
): Promise<boolean> {
  try {
    let hour = time.hour;
    let timezone = time.timezone;
    if (hour === undefined || timezone === undefined) {
      const text = await readSchedule();
      const stored =
        text === null ? DEFAULT_SCHEDULE : ScheduleFile.parse(JSON.parse(text) as unknown);
      hour ??= stored.hour;
      timezone ??= stored.timezone;
    }
    const runHour = fallbackCronHour(hour, scheduleZone(timezone), new Date(deps.now()));
    await createVariableWriter(config, deps.fetch)(RUN_CRON_VARIABLE, `13 ${runHour} * * *`);
    return true;
  } catch (error) {
    (deps.log ?? (() => {}))(`run time not changed: ${describeError(error, secretsOf(config))}`);
    return false;
  }
}

// -------------------------------------------------------------------------------------------- handler

export async function handleConfig(input: ConfigInput, deps: ConfigDeps): Promise<ConfigResult> {
  const config = readServerConfig(deps.env);
  const log = deps.log ?? (() => {});
  if (!config) {
    // Said nowhere else: every edit answers 503 until the deployment has these.
    log(`config unavailable: ${missingSettings(deps.env).join(", ")} not set`);
    return unavailable;
  }

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const request = parseConfigRequest(input.bodyText);
  if (request === null) return invalid;

  // The shared burst cap (D150), taken only by a request that passed the checks above.
  const burstWait = (await deps.burst?.()) ?? 0;
  if (burstWait > 0) return cooldownRefusal(burstWait);

  const storeUrl = configStoreUrl(deps.env);
  if (storeUrl !== null) {
    // Loaded only with the store on. The driver itself also loads for the rate-limit counter
    // whenever DATABASE_URL is set (D150), store on or off.
    const { saveToStore } = await import("./configStore");
    return saveToStore(request, storeUrl, config, deps);
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

    // The hour lives in a repository variable, which run.yml compares against its schedule. A
    // token without "Variables: write" is refused; the rest of the edit is already on its way.
    const time = scheduledTime(request.op);
    if (time === null) {
      return {
        status: 202,
        body: { status: 202, ...(runId !== null ? { run_id: runId } : {}) },
      };
    }
    const timeChanged = await updateRunTime(config, deps, time, () =>
      createGitHubClient(config, deps.fetch).readFile("config/schedule.json", "main"),
    );
    return {
      status: 202,
      body: {
        status: 202,
        ...(runId !== null ? { run_id: runId } : {}),
        time_changed: timeChanged,
      },
    };
  } catch (error) {
    log(`config failed: ${describeError(error, secretsOf(config))}`);
    return unavailable;
  }
}
