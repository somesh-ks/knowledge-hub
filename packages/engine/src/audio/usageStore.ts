import type { UsageFile } from "@singularity/core";

/**
 * Where the month's Speechify character count lives. The engine's narration jobs and the site's
 * narrate function draw on one allowance, so they keep one count (D339): a Blob document per month
 * (usageBlob.ts). The file store is for tests and for a machine with no Blob store.
 */
export interface UsageStore {
  /** The month's count; a month with none stored is zero. */
  load(now: Date): Promise<UsageFile>;
  /** Add billed characters and return the new count. */
  add(now: Date, characters: number): Promise<UsageFile>;
}
