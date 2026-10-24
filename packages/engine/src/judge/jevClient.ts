import { type Env, requireKey } from "@singularity/core";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevClientLike } from "./jev.js";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The real Jev client. SDK retries are off (maxRetries 0) because the judge's withRetry owns
 * them, so attempts are never multiplied. The key comes from the typed env and is never logged.
 */
export function createJevClient(env: Env): JevClientLike {
  return new TypeSafeClient({
    apiKey: requireKey(env, "TYPESAFE_API_KEY"),
    timeout: REQUEST_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    logLevel: "error",
  });
}
