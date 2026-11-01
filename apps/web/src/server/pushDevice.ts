import { isPushEndpoint, removePushDevice, setPushDevice } from "@singularity/engine/push-store";
import type { DatabaseCall } from "./database";
import { isSameOrigin } from "./generate";
import type { ApiResult } from "./http";

/**
 * Which scheduled podcasts a browser hears about (D284): `PUT /api/push-device` says "tell this
 * browser about the Daily, the Weekly, or both", `DELETE` stops all of it. Unlike a watch on a run
 * there is no run to prove, so the check is the address: the browser's own push service only (the
 * same list the watches use), the keys in their shape, a cap on how many devices ask and the shared
 * per-minute cap. A message can only reach the browser that owns the address, so a stranger who
 * registers one gets no one's messages but their own.
 */

export const MAX_DEVICE_BODY_CHARS = 2048;
const MAX_ENDPOINT_CHARS = 1024;
const KEY = /^[A-Za-z0-9_-]{16,128}$/;

export type DeviceBody =
  | { subscribed: true }
  | { error: "cooldown"; retry_after_s: number }
  | { error: "invalid_request" | "too_many" | "unavailable" };

export interface DeviceDeps {
  database: DatabaseCall;
  burst?: () => Promise<number>;
  now: () => number;
}

const UNAVAILABLE: unique symbol = Symbol("unavailable");

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

export async function handlePushDevice(
  input: {
    method: "PUT" | "DELETE";
    bodyText: string;
    origin: string | null;
    expectedOrigin: string;
  },
  deps: DeviceDeps,
): Promise<ApiResult<DeviceBody>> {
  if (!isSameOrigin(input.origin, input.expectedOrigin)) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const body = recordOf(input.bodyText);
  const subscription = (body?.subscription ?? {}) as { endpoint?: unknown; keys?: unknown };
  const endpoint = input.method === "DELETE" ? body?.endpoint : subscription.endpoint;
  if (
    !body ||
    typeof endpoint !== "string" ||
    endpoint.length > MAX_ENDPOINT_CHARS ||
    !isPushEndpoint(endpoint)
  ) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const keys = (subscription.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
  const { daily, weekly } = body;
  if (
    input.method === "PUT" &&
    (typeof keys.p256dh !== "string" ||
      typeof keys.auth !== "string" ||
      !KEY.test(keys.p256dh) ||
      !KEY.test(keys.auth) ||
      typeof daily !== "boolean" ||
      typeof weekly !== "boolean")
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

  const stored = await deps.database<boolean | typeof UNAVAILABLE>(async (sql) => {
    if (input.method === "DELETE") {
      await removePushDevice(sql, endpoint);
      return true;
    }
    return setPushDevice(
      sql,
      {
        endpoint,
        p256dh: String(keys.p256dh),
        auth: String(keys.auth),
        daily: daily === true,
        weekly: weekly === true,
      },
      deps.now(),
    );
  }, UNAVAILABLE);
  if (stored === UNAVAILABLE) return { status: 503, body: { error: "unavailable" } };
  return stored
    ? { status: 200, body: { subscribed: true } }
    : { status: 409, body: { error: "too_many" } };
}
