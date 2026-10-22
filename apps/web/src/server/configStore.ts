import {
  APPLY_DEADLINE_MS,
  applyOpsToDocuments,
  lastConfigWrite,
  readConfigDocuments,
  writeConfigDocumentsAt,
} from "@dispatch/engine/config-store";
import { connectNeon } from "@dispatch/engine/neon";
import { configHash } from "../lib/configHash";
import type { ConfigOp, ConfigReadBody, ConfigResponse } from "../types/contracts";
import { type ServerConfig, type ServerEnv, secretsOf } from "./config";
import { type ConfigDeps, configCooldownSeconds, scheduledTime, updateRunTime } from "./configEdit";
import { type ConfigFiles, storeChanges } from "./configView";

export type { ConfigReadBody };

import type { ApiResult } from "./http";
import { describeError } from "./redact";

/**
 * The config store's side of /api/config (D149), and the cron's read of the stored schedule. Only
 * the store branch loads this module (by a dynamic import), so with DISPATCH_CONFIG_STORE unset none
 * of it runs. The Neon driver itself may still load whenever DATABASE_URL is set, for the shared
 * rate-limit counter (D150). It is imported statically here so Vercel's file tracing puts it in the
 * function.
 */

type ConfigResult = ApiResult<ConfigResponse>;

const unavailable: ConfigResult = { status: 503, body: { status: 503, error: "unavailable" } };
const invalid: ConfigResult = { status: 400, body: { status: 400, error: "invalid_request" } };

async function open(deps: { connectConfigStore?: ConfigDeps["connectConfigStore"] }, url: string) {
  return deps.connectConfigStore ? deps.connectConfigStore(url) : connectNeon(url);
}

/**
 * An edit with the store on. The same checks have passed (origin, body, passphrase); the cooldown
 * counts from the newest stored write, the ops apply to the stored documents and every changed one
 * is written only if none changed since the read (409 otherwise). No workflow runs: the suggestions
 * a new topic got from config.yml wait (D149), since that workflow edits the committed files.
 */
export async function saveToStore(
  request: { op: ConfigOp | ConfigOp[] },
  storeUrl: string,
  config: ServerConfig,
  deps: ConfigDeps,
): Promise<ConfigResult> {
  const log = deps.log ?? (() => {});
  const secrets = [...secretsOf(config), storeUrl];
  try {
    const sql = await open(deps, storeUrl);
    const last = await lastConfigWrite(sql);
    const wait = configCooldownSeconds(last === null ? [] : [last], deps.now());
    if (wait > 0) {
      return {
        status: 429,
        headers: { "Retry-After": String(wait) },
        body: { status: 429, error: "cooldown", retry_after_s: wait },
      };
    }
    // Another edit (another device, or `learn`) can land between the read and the write. The ops
    // are applied once more on top of it before the page is told 409, which it cannot resolve.
    // Both attempts share one deadline, sized to the function's time limit.
    const started = Date.now();
    let result: Awaited<ReturnType<typeof applyOpsToDocuments>> | undefined;
    let written = false;
    let writtenAt: number | null = null;
    for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
      const left = APPLY_DEADLINE_MS - (Date.now() - started);
      if (attempt > 0 && left < 1000) break;
      result = await applyOpsToDocuments(
        {
          ops: request.op,
          documents: await readConfigDocuments(sql),
          baseFiles: deps.baseFiles ?? {},
        },
        left,
      );
      if (!result.ok) {
        log(
          `config ${result.retryable ? "not applied" : "refused"}: ${describeError(result.message, secrets)}`,
        );
        // A lookup that failed on our side, or ran out of time, can be sent again: the page keeps it pending.
        return result.retryable ? unavailable : invalid;
      }
      ({ written, at: writtenAt } = await writeConfigDocumentsAt(sql, result.writes));
    }
    if (!written || !result?.ok) {
      return { status: 409, body: { status: 409, error: "conflict" } };
    }
    // When it landed, by the database's clock: the page compares its copy of the edit with later
    // ones from other devices on that clock, not its own (savedOverlay.ts, withStore).
    const landed = writtenAt === null ? {} : { written_at: writtenAt };
    const time = scheduledTime(request.op);
    if (time === null) return { status: 202, body: { status: 202, ...landed } };
    const schedule = result.documents["config/schedule.json"] ?? null;
    const timeChanged = await updateRunTime(config, deps, time, async () => schedule);
    return { status: 202, body: { status: 202, ...landed, time_changed: timeChanged } };
  } catch (error) {
    log(`config store failed: ${describeError(error, secrets)}`);
    return unavailable;
  }
}

/**
 * The files a page shows: the only rows GET /api/config selects. The writer settings, the
 * discovery queries and the suggestions stay out, and of these only what the pages publish is
 * turned into ops (configView.ts): never votes, opens or the learning history.
 */
const PUBLIC_PATHS = [
  "config/topics.json",
  "config/sources.user.json",
  "config/schedule.json",
  "config/preferences.json",
  "config/profiles/owner.json",
] as const;

/**
 * How long Vercel's edge may answer from its copy: an edit shows on every device within about a
 * second, and a burst of page loads costs one database read a second at most. Browsers keep none.
 */
const READ_CACHE = "public, max-age=0, s-maxage=1";

/**
 * The stored schedule's text, for the cron (D149): with the store on, an edit to the hour is in the
 * database at once and in git only after the next run. Null when the store holds no schedule.
 */
export async function readStoredSchedule(
  storeUrl: string,
  deps: { connectConfigStore?: ConfigDeps["connectConfigStore"] },
): Promise<string | null> {
  const sql = await open(deps, storeUrl);
  const [row] = await readConfigDocuments(sql, ["config/schedule.json"]);
  return row?.content ?? null;
}

const builtHashes = new WeakMap<ConfigFiles, string>();

/** The digest of the bundled files, once per set (they never change within a deployment). */
function builtHash(files: ConfigFiles): string {
  let hash = builtHashes.get(files);
  if (hash === undefined) {
    hash = configHash(files);
    builtHashes.set(files, hash);
  }
  return hash;
}

/** GET /api/config with the store on (the route answers 405 with it off, as before). */
export async function handleConfigRead(deps: {
  env: ServerEnv;
  storeUrl: string;
  /** The public files the pages were built from, bundled with the function. */
  builtFiles: ConfigFiles;
  log?: (message: string) => void;
  connectConfigStore?: ConfigDeps["connectConfigStore"];
}): Promise<ApiResult<ConfigReadBody | { status: 503; error: "unavailable" }>> {
  try {
    const sql = await open(deps, deps.storeUrl);
    const documents = await readConfigDocuments(sql, PUBLIC_PATHS);
    const stored = Object.fromEntries(
      documents.map((document) => [document.path, document.content]),
    );
    const times = documents.flatMap((document) =>
      document.updatedAt === undefined ? [] : [document.updatedAt],
    );
    return {
      status: 200,
      headers: { "Cache-Control": READ_CACHE },
      body: {
        status: 200,
        built: builtHash(deps.builtFiles),
        written_at: times.length > 0 ? Math.max(...times) : null,
        ...storeChanges(deps.builtFiles, stored),
      },
    };
  } catch (error) {
    (deps.log ?? (() => {}))(`config read failed: ${describeError(error, [deps.storeUrl])}`);
    return { status: 503, body: { status: 503, error: "unavailable" } };
  }
}
