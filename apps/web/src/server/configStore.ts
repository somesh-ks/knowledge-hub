import {
  applyOpsToDocuments,
  lastConfigWrite,
  readConfigDocuments,
  writeConfigDocuments,
} from "@dispatch/engine/config-store";
import { connectNeon } from "@dispatch/engine/neon";
import type { ConfigOp, ConfigResponse } from "../types/contracts";
import { type ServerConfig, type ServerEnv, secretsOf } from "./config";
import { type ConfigDeps, configCooldownSeconds, scheduledTime, updateRunTime } from "./configEdit";
import type { ApiResult } from "./http";
import { describeError } from "./redact";

/**
 * The config store's side of /api/config (D149). Only the store branch loads this module (by a
 * dynamic import), so with DISPATCH_CONFIG_STORE unset the function never loads the Neon driver;
 * the driver is imported statically here so Vercel's file tracing puts it in the function.
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
    const result = await applyOpsToDocuments({
      ops: request.op,
      documents: await readConfigDocuments(sql),
      baseFiles: deps.baseFiles ?? {},
    });
    if (!result.ok) {
      log(
        `config ${result.retryable ? "not applied" : "refused"}: ${describeError(result.message, secrets)}`,
      );
      // A lookup that failed on our side, or ran out of time, can be sent again: the page keeps it pending.
      return result.retryable ? unavailable : invalid;
    }
    if (!(await writeConfigDocuments(sql, result.writes))) {
      return { status: 409, body: { status: 409, error: "conflict" } };
    }
    const time = scheduledTime(request.op);
    if (time === null) return { status: 202, body: { status: 202 } };
    const schedule = result.documents["config/schedule.json"] ?? null;
    const timeChanged = await updateRunTime(config, deps, time, async () => schedule);
    return { status: 202, body: { status: 202, time_changed: timeChanged } };
  } catch (error) {
    log(`config store failed: ${describeError(error, secrets)}`);
    return unavailable;
  }
}

export interface ConfigReadBody {
  status: 200;
  /** Each stored config file the built pages publish, with the version an edit to it was made on. */
  documents: Record<string, { version: number; data: unknown }>;
}

/**
 * What GET /api/config may show, file by file: exactly what the built pages already publish, so the
 * route needs no passphrase (a device without one must still see the owner's settings, as the pages
 * show them). Files no page shows (the writer settings, the discovery queries, the suggestions) and
 * the private parts of the others (story votes and opens, the learning history) are left out.
 */
const PUBLIC_VIEW: Record<string, ((data: Record<string, unknown>) => unknown) | undefined> = {
  "config/topics.json": (data) => data,
  "config/sources.user.json": (data) => data,
  "config/schedule.json": (data) => data,
  "config/preferences.json": (data) => ({ weights: data.weights, format_mix: data.format_mix }),
  "config/profiles/owner.json": (data) => ({ blocked_domains: data.blocked_domains }),
};

/** GET /api/config with the store on (the route answers 405 with it off, as before). */
export async function handleConfigRead(deps: {
  env: ServerEnv;
  storeUrl: string;
  log?: (message: string) => void;
  connectConfigStore?: ConfigDeps["connectConfigStore"];
}): Promise<ApiResult<ConfigReadBody | { status: 503; error: "unavailable" }>> {
  try {
    const sql = await open(deps, deps.storeUrl);
    const documents: ConfigReadBody["documents"] = {};
    for (const document of await readConfigDocuments(sql)) {
      const view = PUBLIC_VIEW[document.path];
      if (view === undefined) continue;
      try {
        const data = JSON.parse(document.content) as Record<string, unknown>;
        documents[document.path] = { version: document.version, data: view(data) };
      } catch {
        // A row that is not JSON is left out; the page keeps its built copy of that file.
      }
    }
    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      body: { status: 200, documents },
    };
  } catch (error) {
    (deps.log ?? (() => {}))(`config read failed: ${describeError(error, [deps.storeUrl])}`);
    return { status: 503, body: { status: 503, error: "unavailable" } };
  }
}
