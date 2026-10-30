import { COOKIE, cookieOf, sessionValid } from "../../../admin/src/gate/session";
import { toResponse } from "./http";

export interface AdminGuardEnv {
  /** ADMIN_SESSION_SECRET: the same value the command center signs its session with. */
  secret?: string;
  /** Local `astro dev`, where the command center's dev proxy carries no cookie. */
  dev?: boolean;
}

/** The command center's gate (MIN_SECRET in apps/admin/src/gate/gate.ts) refuses a shorter secret. */
const MIN_SECRET = 32;

/**
 * Spend and health are the owner's: the two report routes answer only a request that carries the
 * command center's session cookie (D257). Returns the refusal to send, or null to answer. With no
 * usable secret nothing is answered (503), as the gate itself fails closed.
 */
export async function adminOnly(
  request: Request,
  env: AdminGuardEnv,
  now: number = Date.now(),
): Promise<Response | null> {
  if (env.dev) return null;
  const { secret } = env;
  if (!secret || secret.length < MIN_SECRET) {
    return toResponse({ status: 503, body: { error: "admin_not_set_up" } });
  }
  if (await sessionValid(cookieOf(request, COOKIE), secret, now)) return null;
  return toResponse({ status: 401, body: { error: "unauthorized" } });
}

/** The guard as a route runs it: the secret from the environment, the dev flag from the build. */
export const guardAdmin = (request: Request): Promise<Response | null> =>
  adminOnly(request, {
    secret: process.env.ADMIN_SESSION_SECRET,
    dev: import.meta.env.DEV,
  });
