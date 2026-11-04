import type { BlobCredentials } from "./config";
import { BLOB_CALL_TIMEOUT_MS } from "./functionLimits.mjs";

/**
 * The slice of Vercel Blob that /api/narrate uses, as an interface so the handler is tested against
 * an in-memory fake and never against the network. `createVercelBlobStore` is the real one.
 *
 * Operations are a budget here, like Speechify characters. The Hobby plan includes 2,000 ADVANCED
 * operations a month (put, and list, which this never calls) and 10,000 SIMPLE ones (head, and a read by URL that misses the
 * CDN cache). A delete and a cached read are free. Going over blocks the store for 30 days, so each
 * method below says what it costs, and narrate.ts counts what each request spends.
 */

export interface BlobEntry {
  pathname: string;
  url: string;
  /** Upload time in epoch milliseconds, by the store's clock. */
  uploadedAt: number;
  /** Size in bytes, or 0 when the store did not say. */
  size: number;
  /** Changes whenever the content does. `versionedUrl` puts it in the URL. */
  version: string;
  /** The store's own ETag, as it sent it, for a delete that must only hit this exact content. */
  etag: string | null;
}

export interface BlobWriteOptions {
  contentType: string;
  /** Edge and browser cache lifetime in seconds. Vercel Blob's floor is 60. */
  cacheSeconds: number;
  /** Give up on this call after this long. Without it the store's own limit applies. */
  timeoutMs?: number;
}

export interface NarrateBlobStore {
  /** SIMPLE. Metadata only, without downloading the object. Null when nothing is stored there. */
  head(pathname: string): Promise<BlobEntry | null>;
  /**
   * SIMPLE when the CDN has not seen this URL, free when it has. The object's text, read by URL,
   * or null when there is none. The CDN answers from its cache, so a plain URL can return an old
   * copy. Never call this with a bare URL for anything that changes: use `readFresh`.
   */
  fetchText(url: string): Promise<string | null>;
  /** ADVANCED. Writes at a fixed pathname, replacing what was there, and returns the public URL. */
  put(
    pathname: string,
    body: Uint8Array | string,
    options: BlobWriteOptions,
  ): Promise<{ url: string }>;
  /**
   * ADVANCED. Writes only if nothing is stored there yet, and says whether it did. The store
   * decides, so of two requests that create the same object at once, exactly one is told yes.
   */
  create(pathname: string, body: string, options: BlobWriteOptions): Promise<boolean>;
  /** Free. */
  del(pathname: string): Promise<void>;
  /**
   * Free. Deletes the object only if it is still the one `entry` describes, and says whether it
   * did. An object that has been replaced since it was read is left alone.
   */
  delIfUnchanged(entry: BlobEntry): Promise<boolean>;
}

/** The object's URL with its version in the query, so the CDN cannot answer with an older copy. */
export function versionedUrl(entry: BlobEntry): string {
  const url = new URL(entry.url);
  url.searchParams.set("v", entry.version);
  return url.href;
}

/**
 * The current content of an object that changes: its metadata from the store, then its text by a
 * URL that names the version the store just reported. A new version is a URL the CDN has never
 * seen, so it has to fetch the real thing; an unchanged object is the same URL again, which the CDN
 * serves from cache for free. Two SIMPLE operations at most.
 */
export async function readFresh(
  blob: NarrateBlobStore,
  pathname: string,
): Promise<{ entry: BlobEntry; text: string } | null> {
  const entry = await blob.head(pathname);
  if (entry === null) return null;
  const text = await blob.fetchText(versionedUrl(entry));
  // The store just said the object exists. If its content cannot be had, that is a failure, and it
  // must not pass for "nothing stored": for the month's document that would read as an empty month.
  if (text === null) throw new Error(`${pathname} exists but its content could not be read`);
  return { entry, text };
}

interface SdkBlob {
  url: string;
  pathname: string;
  uploadedAt: Date;
  size?: number;
  etag?: string;
}

type Bounded = BlobCredentials & { abortSignal: AbortSignal };

/**
 * The functions of `@vercel/blob` the store calls, typed by what it passes and reads. The route
 * hands in the real module; the adapter's test hands in fakes.
 */
export interface BlobSdk {
  head(pathname: string, options: Bounded): Promise<SdkBlob>;
  put(
    pathname: string,
    body: string | Buffer,
    options: Bounded & {
      access: "public";
      addRandomSuffix: false;
      allowOverwrite: boolean;
      contentType: string;
      cacheControlMaxAge: number;
    },
  ): Promise<{ url: string }>;
  del(urlOrPathname: string, options: Bounded & { ifMatch?: string }): Promise<void>;
}

/** Reads a blob by URL. The global `fetch` in production, a fake in the adapter's test. */
export type BlobFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** The store holds small JSON files besides the audio; nothing read as text should be near this. */
export const MAX_TEXT_BYTES = 1_000_000;

function toEntry(blob: SdkBlob): BlobEntry {
  return {
    pathname: blob.pathname,
    url: blob.url,
    uploadedAt: blob.uploadedAt.getTime(),
    size: blob.size && blob.size > 0 ? blob.size : 0,
    // The ETag changes with the content. The upload time is the fallback when there is none.
    version: blob.etag ? blob.etag.replace(/[^A-Za-z0-9]/g, "") : String(blob.uploadedAt.getTime()),
    etag: blob.etag ?? null,
  };
}

/**
 * The SDK's error classes, loaded on the first failed call. Every page reads the store through this
 * module (readPublicText, a plain fetch) and never calls the SDK: importing it at the top added
 * about 80 ms to each cold start of the function (2026-11-01).
 */
const sdkErrors = () => import("@vercel/blob");

/**
 * A put that was told not to overwrite and found something there. The SDK has no error class for
 * it: the store answers with a plain error whose message says the blob already exists.
 */
async function isAlreadyThere(error: unknown): Promise<boolean> {
  const { BlobError } = await sdkErrors();
  return error instanceof BlobError && /already exists/i.test(error.message);
}

/**
 * The response body as text, read no further than `limit` bytes. The store's own report of a size
 * is not trusted for this: it can be missing or zero, and then it would wave anything through.
 */
async function readText(response: Response, limit: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("the object is too large to be one of the store's JSON files");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Runs one call with a time limit. The signal is handed to the call so it can stop its request,
 * and the limit holds even if it does not: the SDK retries up to ten times by itself, and its waits
 * between tries do not listen to a signal. Without this, one slow call could outlast the function.
 */
async function withLimit<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        const reason = new DOMException("The store did not answer in time", "TimeoutError");
        controller.abort(reason);
        reject(reason);
      },
      Math.max(1, timeoutMs),
    );
  });
  try {
    const work = call(controller.signal);
    // If the limit wins, whatever the call does afterwards is nobody's to handle.
    work.catch(() => undefined);
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SIMPLE when the CDN has not seen this URL, free when it has. A public object's text, read by URL
 * with no credentials, or null when there is none. The same read as `fetchText`, for a caller that
 * is given no store.
 */
export async function readPublicText(
  url: string,
  doFetch: BlobFetch,
  limit = MAX_TEXT_BYTES,
): Promise<string | null> {
  if (!url.startsWith("https://")) throw new Error("refusing to read a blob that is not https");
  return withLimit(BLOB_CALL_TIMEOUT_MS, async (signal) => {
    const response = await doFetch(url, { signal });
    if (response.status === 404) return null;
    // The status only: a body from the store or the CDN never goes into a message.
    if (!response.ok) throw new Error(`the store answered ${response.status} to a read`);
    return readText(response, limit);
  });
}

/**
 * Wraps `@vercel/blob` with the credentials passed on every call, so it never depends on what
 * happens to be in process.env. Objects are public and at fixed pathnames. Every call has a time
 * limit of its own.
 */
export function createVercelBlobStore(
  credentials: BlobCredentials,
  sdk: BlobSdk,
  doFetch: BlobFetch,
): NarrateBlobStore {
  const write = (
    pathname: string,
    body: Uint8Array | string,
    options: BlobWriteOptions,
    allowOverwrite: boolean,
  ): Promise<{ url: string }> =>
    withLimit(options.timeoutMs ?? BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
      sdk.put(
        pathname,
        typeof body === "string"
          ? body
          : Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite,
          contentType: options.contentType,
          cacheControlMaxAge: options.cacheSeconds,
          ...credentials,
          abortSignal,
        },
      ),
    );

  return {
    async head(pathname) {
      try {
        return toEntry(
          await withLimit(BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
            sdk.head(pathname, { ...credentials, abortSignal }),
          ),
        );
      } catch (error) {
        if (error instanceof (await sdkErrors()).BlobNotFoundError) return null;
        throw error;
      }
    },

    fetchText: (url) => readPublicText(url, doFetch),

    async put(pathname, body, options) {
      const result = await write(pathname, body, options, true);
      return { url: result.url };
    },

    async create(pathname, body, options) {
      try {
        await write(pathname, body, options, false);
        return true;
      } catch (error) {
        if (await isAlreadyThere(error)) return false;
        throw error;
      }
    },

    async del(pathname) {
      await withLimit(BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
        sdk.del(pathname, { ...credentials, abortSignal }),
      );
    },

    async delIfUnchanged(entry) {
      const etag = entry.etag;
      // The store always reports an ETag. Without one there is nothing to match on, and a plain
      // delete is the only way left to clear the object at all.
      if (etag === null) {
        await this.del(entry.pathname);
        return true;
      }
      try {
        // By URL: the SDK only takes a condition when it deletes one object by its URL.
        await withLimit(BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
          sdk.del(entry.url, { ...credentials, abortSignal, ifMatch: etag }),
        );
        return true;
      } catch (error) {
        const { BlobNotFoundError, BlobPreconditionFailedError } = await sdkErrors();
        if (error instanceof BlobPreconditionFailedError || error instanceof BlobNotFoundError) {
          return false;
        }
        throw error;
      }
    },
  };
}
