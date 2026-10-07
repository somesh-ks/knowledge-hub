import { BlobNotFoundError } from "@vercel/blob";
import type { BlobCredentials } from "./config";

/**
 * The slice of Vercel Blob that /api/narrate uses, as an interface so the handler is tested against
 * an in-memory fake and never against the network. `createVercelBlobStore` is the real one.
 */

/** One stored object. `uploadedAt` is epoch milliseconds, by the store's clock. */
export interface BlobEntry {
  pathname: string;
  url: string;
  uploadedAt: number;
}

export interface BlobWriteOptions {
  contentType: string;
  /** Edge and browser cache lifetime in seconds. Vercel Blob's floor is 60. */
  cacheSeconds: number;
}

export interface NarrateBlobStore {
  /** Metadata only, without downloading the object. Null when nothing is stored there. */
  head(pathname: string): Promise<BlobEntry | null>;
  /**
   * The object as text, or null when nothing is stored there. Always read past the CDN cache: the
   * function decides from these files whether to spend, and a copy up to a minute old (or a cached
   * "not found") could make it narrate a digest twice.
   */
  readText(pathname: string): Promise<string | null>;
  /** Everything under a prefix, every page. */
  list(prefix: string): Promise<BlobEntry[]>;
  /** Writes at a fixed pathname, replacing what was there, and returns the public URL. */
  put(
    pathname: string,
    body: Uint8Array | string,
    options: BlobWriteOptions,
  ): Promise<{ url: string }>;
  del(pathname: string): Promise<void>;
}

interface SdkBlob {
  url: string;
  pathname: string;
  uploadedAt: Date;
}

/**
 * The functions of `@vercel/blob` the store calls, typed by what it passes and reads. The route
 * hands in the real module; the adapter's test hands in fakes.
 */
export interface BlobSdk {
  head(pathname: string, options: BlobCredentials): Promise<SdkBlob>;
  get(
    pathname: string,
    options: BlobCredentials & { access: "public"; useCache: false },
  ): Promise<{ stream: ReadableStream<Uint8Array> | null; blob: { size: number | null } } | null>;
  list(
    options: BlobCredentials & { prefix: string; cursor?: string },
  ): Promise<{ blobs: SdkBlob[]; cursor?: string; hasMore: boolean }>;
  put(
    pathname: string,
    body: string | Buffer,
    options: BlobCredentials & {
      access: "public";
      addRandomSuffix: false;
      allowOverwrite: true;
      contentType: string;
      cacheControlMaxAge: number;
    },
  ): Promise<{ url: string }>;
  del(pathname: string, options: BlobCredentials): Promise<void>;
}

/** The store holds small JSON files besides the audio; nothing read as text should be near this. */
const MAX_TEXT_BYTES = 1_000_000;
/** A listing is 1,000 objects a page. This is far past one narration per digest for years. */
const MAX_LIST_PAGES = 20;

function toEntry(blob: SdkBlob): BlobEntry {
  return { pathname: blob.pathname, url: blob.url, uploadedAt: blob.uploadedAt.getTime() };
}

/**
 * Wraps `@vercel/blob` with the credentials passed on every call, so it never depends on what
 * happens to be in process.env. Objects are public, at fixed pathnames, and overwritten in place, so
 * a digest's audio URL stays the same across reruns.
 */
export function createVercelBlobStore(
  credentials: BlobCredentials,
  sdk: BlobSdk,
): NarrateBlobStore {
  return {
    async head(pathname) {
      try {
        return toEntry(await sdk.head(pathname, credentials));
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },

    async readText(pathname) {
      let result: Awaited<ReturnType<BlobSdk["get"]>>;
      try {
        result = await sdk.get(pathname, { access: "public", useCache: false, ...credentials });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
      if (result === null || result.stream === null) return null;
      if ((result.blob.size ?? 0) > MAX_TEXT_BYTES) {
        throw new Error(`${pathname} is too large to be one of the store's JSON files`);
      }
      return await new Response(result.stream).text();
    },

    async list(prefix) {
      const entries: BlobEntry[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await sdk.list({ prefix, ...(cursor ? { cursor } : {}), ...credentials });
        entries.push(...result.blobs.map(toEntry));
        if (!result.hasMore || !result.cursor) return entries;
        cursor = result.cursor;
      }
      throw new Error(`Listing ${prefix} did not end after ${MAX_LIST_PAGES} pages`);
    },

    async put(pathname, body, options) {
      const result = await sdk.put(
        pathname,
        typeof body === "string"
          ? body
          : Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: options.contentType,
          cacheControlMaxAge: options.cacheSeconds,
          ...credentials,
        },
      );
      return { url: result.url };
    },

    async del(pathname) {
      await sdk.del(pathname, credentials);
    },
  };
}
