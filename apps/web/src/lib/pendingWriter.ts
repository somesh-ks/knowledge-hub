/**
 * The writer's own note of a provider and model saved since the build (written once the request that
 * carried it went through, remember in scripts/managePageSave.ts; a refused choice is never noted):
 * the Settings page shows it in place of the built choice. On its own
 * and DOM-free, so the index's first script can ask whether there is one without loading the editor.
 */
import type { Provider } from "./settingsSummary";

export const PENDING_WRITER_KEY = "dispatch:writer-pending";
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

export interface StoredWriterChoice {
  provider: Provider;
  model: string | null;
  timestamp: number;
}

export function readPendingChoice(
  storage: Storage | null = typeof sessionStorage !== "undefined" ? sessionStorage : null,
): StoredWriterChoice | null {
  try {
    const raw = storage?.getItem(PENDING_WRITER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredWriterChoice>;
    if (
      (data.provider === "nebius" || data.provider === "anthropic") &&
      (typeof data.model === "string" || data.model === null) &&
      typeof data.timestamp === "number" &&
      Date.now() - data.timestamp < PENDING_MAX_AGE_MS
    ) {
      return { provider: data.provider, model: data.model, timestamp: data.timestamp };
    }
  } catch {
    // storage unavailable or malformed
  }
  return null;
}

export function writePendingChoice(
  provider: Provider,
  model: string | null,
  storage: Storage | null = typeof sessionStorage !== "undefined" ? sessionStorage : null,
): void {
  try {
    storage?.setItem(
      PENDING_WRITER_KEY,
      JSON.stringify({ provider, model, timestamp: Date.now() }),
    );
  } catch {
    // storage unavailable
  }
}

export function clearPendingChoice(
  storage: Storage | null = typeof sessionStorage !== "undefined" ? sessionStorage : null,
): void {
  try {
    storage?.removeItem(PENDING_WRITER_KEY);
  } catch {
    // storage unavailable
  }
}

/** Whether a saved writer choice may be waiting for the build: then the index loads its overlay. */
export function hasPendingChoice(): boolean {
  return readPendingChoice() !== null;
}
