import type { SqlClient } from "@singularity/engine/config-paths";
import {
  addPushWatch,
  ensurePushKeys,
  isPushEndpoint,
  removePushWatch,
  type WatchKind,
} from "@singularity/engine/push-store";
import { cancelTokenMatches } from "./cancelToken";
import { readServerConfig, type ServerEnv } from "./config";
import type { DatabaseCall } from "./database";
import { isSameOrigin } from "./generate";
import { parseCancelToken } from "./generations";
import type { ApiResult } from "./http";
import { parseRunId } from "./status";

/**
 * Push notifications (D284). `POST /api/push` says "tell this browser when this run ends", `DELETE`
 * takes that back, and `GET` hands the browser the public key it subscribes with. Who may watch a run
 * is who may stop it: the run's cancel token (cancelToken.ts, D242), which only the device that
 * started the run holds. So no one can have a message sent about a run they did not start, and a
 * stranger's address is never stored without one. The watches live in Neon (engine/store/pushStore.ts);
 * `singularity push notify` sends them after the content sync.
 */

export const MAX_PUSH_BODY_CHARS = 2048;
/** A browser's push address is under 500 characters in practice; the keys are 87 and 22. */
const MAX_ENDPOINT_CHARS = 1024;
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
const KINDS: readonly WatchKind[] = ["catch_up", "regenerate"];

export type PushBody =
  | { watching: true }
  | { public_key: string }
  | { error: "cooldown"; retry_after_s: number }
  | { error: "invalid_request" | "forbidden" | "too_many" | "unavailable" };

export interface PushDeps {
  env: ServerEnv;
  /** Neon, guarded (server/database.ts): its fallback stands for a store that cannot answer. */
  database: DatabaseCall;
  burst?: () => Promise<number>;
  now: () => number;
}

const UNAVAILABLE: unique symbol = Symbol("unavailable");

/** Runs `work` on Neon, or answers UNAVAILABLE when the store cannot. */
const ask = <T>(
  deps: { database: DatabaseCall },
  work: (sql: SqlClient) => Promise<T>,
): Promise<T | typeof UNAVAILABLE> => deps.database<T | typeof UNAVAILABLE>(work, UNAVAILABLE);

function recordOf(bodyText: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(bodyText);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * GET: the key to subscribe with. The first call makes the pair and keeps it in Neon, so there is
 * nothing for the owner to set up; 503 while the store cannot answer.
 */
export async function handlePushKey(deps: PushDeps): Promise<ApiResult<PushBody>> {
  const keys = await ask(deps, (sql) => ensurePushKeys(sql, deps.now()));
  return keys === UNAVAILABLE
    ? { status: 503, body: { error: "unavailable" } }
    : { status: 200, body: { public_key: keys.publicKey } };
}

export async function handlePushWatch(
  input: {
    method: "POST" | "DELETE";
    bodyText: string;
    origin: string | null;
    expectedOrigin: string;
  },
  deps: PushDeps,
): Promise<ApiResult<PushBody>> {
  const config = readServerConfig(deps.env);
  if (!config) return { status: 503, body: { error: "unavailable" } };
  if (!isSameOrigin(input.origin, input.expectedOrigin)) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const body = recordOf(input.bodyText);
  const runId = typeof body?.run_id === "number" ? parseRunId(String(body.run_id)) : null;
  if (!body || runId === null) return { status: 400, body: { error: "invalid_request" } };
  // The same answer for a missing, a wrong and a stale token, before any database call.
  if (!cancelTokenMatches(config.token, runId, parseCancelToken(input.bodyText))) {
    return { status: 403, body: { error: "forbidden" } };
  }

  const subscription = (body.subscription ?? {}) as { endpoint?: unknown; keys?: unknown };
  const endpoint = input.method === "DELETE" ? body.endpoint : subscription.endpoint;
  if (
    typeof endpoint !== "string" ||
    endpoint.length > MAX_ENDPOINT_CHARS ||
    !isPushEndpoint(endpoint)
  ) {
    return { status: 400, body: { error: "invalid_request" } };
  }

  const wait = (await deps.burst?.()) ?? 0;
  if (wait > 0) {
    return {
      status: 429,
      headers: { "Retry-After": String(wait) },
      body: { error: "cooldown", retry_after_s: wait },
    };
  }

  const runKey = String(runId);
  if (input.method === "DELETE") {
    const done = await ask(deps, async (sql) => {
      await removePushWatch(sql, runKey, endpoint);
      return true;
    });
    return done === UNAVAILABLE
      ? { status: 503, body: { error: "unavailable" } }
      : { status: 200, body: { watching: true } };
  }

  const keys = (subscription.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
  const kind = KINDS.find((candidate) => candidate === body.kind);
  if (
    !kind ||
    typeof keys.p256dh !== "string" ||
    typeof keys.auth !== "string" ||
    !KEY.test(keys.p256dh) ||
    !KEY.test(keys.auth)
  ) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const { p256dh, auth } = keys;
  const stored = await ask(deps, (sql) =>
    addPushWatch(sql, { run_id: runKey, endpoint, p256dh, auth, kind }, deps.now()),
  );
  if (stored === UNAVAILABLE) return { status: 503, body: { error: "unavailable" } };
  return stored
    ? { status: 200, body: { watching: true } }
    : { status: 409, body: { error: "too_many" } };
}
