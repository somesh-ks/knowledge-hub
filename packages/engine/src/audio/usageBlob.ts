import { UsageFile } from "@singularity/core";
import {
  type BlobClient,
  type ConditionalBlobClient,
  isAlreadyExists,
  isPreconditionFailed,
  readCurrent,
  type TaggedText,
} from "../publish/blob.js";
import { fileUsageStore } from "./budget.js";
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

interface Stored {
  /** The document as stored, every field kept. Null when nothing is stored for the month. */
  raw: Record<string, unknown> | null;
  /** The version the read saw, for a write that must not overwrite a newer one. */
  etag: string | null;
  usage: UsageFile;
}

async function read(
  client: ConditionalBlobClient,
  month: string,
  known?: TaggedText,
): Promise<Stored> {
  const key = usageBlobKey(month);
  // The current copy, never the CDN's older one: a count read stale and written back with the
  // current ETag would erase the characters added since. A document that exists but cannot be read
  // throws, so it never passes for an empty month, which would switch the budget off.
  const entry = await readCurrent(client, key, known);
  if (entry === null) return { raw: null, etag: null, usage: emptyUsage(month) };
  let raw: unknown;
  try {
    raw = JSON.parse(entry.text);
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
export function blobUsageStore(client: ConditionalBlobClient): UsageStore {
  // The last document this store wrote: a load right after a charge reads it without waiting out
  // the CDN.
  let written: TaggedText | undefined;
  return {
    async load(now) {
      return (await read(client, usageMonth(now), written)).usage;
    },
    async add(now, characters) {
      const month = usageMonth(now);
      for (let attempt = 1; ; attempt++) {
        const stored = await read(client, month, written);
        const usage: UsageFile = {
          ...stored.usage,
          speechify: {
            month,
            characters: stored.usage.speechify.characters + characters,
          },
        };
        const body = `${JSON.stringify({ digests: {}, ...stored.raw, ...usage }, null, 2)}\n`;
        try {
          const result = await client.put(usageBlobKey(month), new TextEncoder().encode(body), {
            contentType: "application/json",
            cacheControlMaxAge: JSON_CACHE_SECONDS,
            // A month nobody has charged yet is created, never overwritten: of two first writers
            // the second is told, reads the first's count and adds to it.
            ...(stored.etag !== null ? { ifMatch: stored.etag } : { createOnly: true }),
          });
          written = result.etag === undefined ? undefined : { text: body, etag: result.etag };
          return usage;
        } catch (error) {
          const lostRace = isPreconditionFailed(error) || isAlreadyExists(error);
          if (!lostRace || attempt >= ATTEMPTS) throw error;
        }
      }
    },
  };
}

/**
 * The Blob count plus the characters `state/usage.json` holds for the month. The engine counted in
 * that file before D339 and nothing writes it now, so it stays at what it was until the month turns
 * and a gate that left it out would approve narration the allowance no longer has room for. Writes
 * go to Blob only.
 */
export function withFrozenFile(shared: UsageStore, file: UsageStore): UsageStore {
  const sum = async (now: Date, into: UsageFile): Promise<UsageFile> => {
    const frozen = await file.load(now);
    return {
      ...into,
      speechify: {
        ...into.speechify,
        characters: into.speechify.characters + frozen.speechify.characters,
      },
    };
  };
  return {
    load: async (now) => sum(now, await shared.load(now)),
    add: async (now, characters) => sum(now, await shared.add(now, characters)),
  };
}

/** The shared count when the client can write conditionally (the real one can), else nothing: the file store applies. */
export function usageStoreFor(blob: BlobClient, root: string): UsageStore | undefined {
  return "head" in blob
    ? withFrozenFile(blobUsageStore(blob as ConditionalBlobClient), fileUsageStore(root))
    : undefined;
}
