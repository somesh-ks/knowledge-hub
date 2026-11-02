import { UsageFile } from "@singularity/core";
import {
  type BlobClient,
  type ConditionalBlobClient,
  isPreconditionFailed,
} from "../publish/blob.js";
import { emptyUsage, usageMonth } from "./budgetMath.js";
import type { UsageStore } from "./usageStore.js";

/**
 * The month's Speechify count in the content store, at the key the site's narrate function writes
 * (apps/web narrationState.ts `usageKey`). The site's document holds more than the engine's
 * (`digests`, the per-digest charges), so a write here changes `speechify.characters` and leaves
 * every other field as it found it.
 */
export const usageBlobKey = (month: string): string => `state/usage-${month}.json`;

const JSON_CACHE_SECONDS = 60;
const ATTEMPTS = 4;

export type FetchText = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

interface Stored {
  /** The document as stored, every field kept. Null when nothing is stored for the month. */
  raw: Record<string, unknown> | null;
  /** The version the read saw, for a write that must not overwrite a newer one. */
  etag: string | null;
  usage: UsageFile;
}

async function read(client: ConditionalBlobClient, get: FetchText, month: string): Promise<Stored> {
  const key = usageBlobKey(month);
  const entry = await client.head(key);
  if (entry === null) return { raw: null, etag: null, usage: emptyUsage(month) };
  // The version in the query names a URL the CDN has not cached, so the read is never an old copy.
  const url = new URL(entry.url);
  url.searchParams.set("v", entry.etag);
  const answer = await get(url.href);
  // The store said the document exists: failing to read it must not pass for an empty month, which
  // would switch the budget off.
  if (!answer.ok) throw new Error(`${key} exists but could not be read (status ${answer.status})`);
  let raw: unknown;
  try {
    raw = JSON.parse(await answer.text());
  } catch {
    throw new Error(`${key} is not valid JSON`);
  }
  const usage = UsageFile.safeParse(raw);
  if (!usage.success || usage.data.speechify.month !== month) {
    throw new Error(`${key} is not a valid usage document for ${month}`);
  }
  return { raw: raw as Record<string, unknown>, etag: entry.etag, usage: usage.data };
}

/** The count in Blob, shared with the site. A write that loses a race to another writer reads again and retries. */
export function blobUsageStore(
  client: ConditionalBlobClient,
  get: FetchText = (url) => fetch(url),
): UsageStore {
  return {
    async load(now) {
      return (await read(client, get, usageMonth(now))).usage;
    },
    async add(now, characters) {
      const month = usageMonth(now);
      for (let attempt = 1; ; attempt++) {
        const stored = await read(client, get, month);
        const usage: UsageFile = {
          ...stored.usage,
          speechify: {
            month,
            characters: stored.usage.speechify.characters + characters,
          },
        };
        const body = `${JSON.stringify({ digests: {}, ...stored.raw, ...usage }, null, 2)}\n`;
        try {
          await client.put(usageBlobKey(month), new TextEncoder().encode(body), {
            contentType: "application/json",
            cacheControlMaxAge: JSON_CACHE_SECONDS,
            ...(stored.etag !== null ? { ifMatch: stored.etag } : {}),
          });
          return usage;
        } catch (error) {
          if (!isPreconditionFailed(error) || attempt >= ATTEMPTS) throw error;
        }
      }
    },
  };
}

/** The shared count when the client can write conditionally (the real one can), else nothing: the file store applies. */
export function usageStoreFor(blob: BlobClient): UsageStore | undefined {
  return "head" in blob ? blobUsageStore(blob as ConditionalBlobClient) : undefined;
}
