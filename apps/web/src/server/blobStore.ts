import { waitUntil } from "@vercel/functions";
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
  /** Changes whenever the content does: the ETag without its quotes, or the upload time. */
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
   * SIMPLE when the CDN has not cached this path, free when it has. The object's text, read by URL,
   * or null when there is none. After an overwrite the CDN answers with the old copy for up to a
   * minute, and a query string does not get past it. Never base a write on this: use `textOf`.
   */
  fetchText(url: string): Promise<string | null>;
  /**
   * The text of the version `entry` describes, or of a later one, never an older copy the CDN still
   * holds. Free or SIMPLE; one ADVANCED and one SIMPLE more when the CDN is behind. Throws when it
   * cannot be had.
   */
  textOf(entry: BlobEntry): Promise<string>;
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
  /**
   * ADVANCED. Overwrites only if the object still carries `etag`, and says whether it did. Of two
   * requests that change the same version at once, exactly one is told yes.
   */
  replace(
    pathname: string,
    body: string,
    options: BlobWriteOptions,
    etag: string,
  ): Promise<boolean>;
  /** Free. */
  del(pathname: string): Promise<void>;
  /**
   * Free. Deletes the object only if it is still the one `entry` describes, and says whether it
   * did. An object that has been replaced since it was read is left alone.
   */
  delIfUnchanged(entry: BlobEntry): Promise<boolean>;
}

/**
 * An object's metadata from the store, then its text as the CDN has it: up to a minute old after an
 * overwrite. For reads that only show or look up; a write builds on `updateCurrent`. Two SIMPLE
 * operations at most, and the read is free while the CDN holds the path.
 */
export async function readStored(
  blob: NarrateBlobStore,
  pathname: string,
): Promise<{ entry: BlobEntry; text: string } | null> {
  const entry = await blob.head(pathname);
  if (entry === null) return null;
  const text = await blob.fetchText(entry.url);
  // The store just said the object exists. If its content cannot be had, that is a failure, and it
  // must not pass for "nothing stored": for the month's document that would read as an empty month.
  if (text === null) throw new Error(`${pathname} exists but its content could not be read`);
  return { entry, text };
}

/** How many writers in a row may change an object under one read-modify-write before it gives up. */
const UPDATE_ATTEMPTS = 3;

/**
 * Read-modify-write of a small JSON object, safe against the CDN and other writers. `change` gets
 * the current text (null when there is none) and returns the new text, or null to write nothing.
 * The write only lands on the version that was read; when another writer got there first, it reads
 * again and asks `change` again. A stale read written back would erase what the other wrote: for
 * the month's Speechify count, a charge (2026-11-04). Says whether it wrote.
 */
export async function updateCurrent(
  blob: NarrateBlobStore,
  pathname: string,
  options: BlobWriteOptions,
  change: (text: string | null) => string | null,
): Promise<boolean> {
  let tried: string | null = null;
  for (let attempt = 1; attempt <= UPDATE_ATTEMPTS; attempt += 1) {
    const entry = await blob.head(pathname);
    const text = entry === null ? null : await blob.textOf(entry);
    // The last write landed after all: its answer was lost and the SDK's own retry was refused.
    if (text !== null && text === tried) return true;
    const body = change(text);
    if (body === null) return false;
    tried = body;
    if (entry === null) {
      if (await blob.create(pathname, body, options)) return true;
    } else if (entry.etag === null) {
      // shortcut: the store always sends an ETag; without one the write is held to nothing and a
      // stale read can be written back. If a head ever comes without one, refuse here instead.
      await blob.put(pathname, body, options);
      return true;
    } else if (await blob.replace(pathname, body, options, entry.etag)) {
      return true;
    }
  }
  throw new Error(`${pathname} changed under ${UPDATE_ATTEMPTS} writes in a row`);
}

interface SdkBlob {
  url: string;
  pathname: string;
  uploadedAt: Date;
  size?: number;
  etag?: string;
}

type CreateOptions = {
  access: "public";
  addRandomSuffix: boolean;
  allowOverwrite: boolean;
  contentType: string;
  cacheControlMaxAge: number;
};

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
    options: Bounded & CreateOptions & { ifMatch?: string },
  ): Promise<{ url: string; etag?: string }>;
  /** Server side, from the store itself: the copy is of the current version, whatever the CDN holds. */
  copy(
    fromUrl: string,
    toPathname: string,
    options: Bounded & CreateOptions,
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

/** A public object's text and the ETag of the copy that answered, or null when there is none. */
async function readTagged(
  url: string,
  doFetch: BlobFetch,
  limit: number,
): Promise<{ text: string; etag: string | null } | null> {
  if (!url.startsWith("https://")) throw new Error("refusing to read a blob that is not https");
  return withLimit(BLOB_CALL_TIMEOUT_MS, async (signal) => {
    const response = await doFetch(url, { signal });
    if (response.status === 404) return null;
    // The status only: a body from the store or the CDN never goes into a message.
    if (!response.ok) throw new Error(`the store answered ${response.status} to a read`);
    return { text: await readText(response, limit), etag: response.headers.get("etag") };
  });
}

/**
 * SIMPLE when the CDN has not cached this path, free when it has. A public object's text, read by
 * URL with no credentials, or null when there is none. The same read as `fetchText`, for a caller
 * that is given no store.
 */
export async function readPublicText(
  url: string,
  doFetch: BlobFetch,
  limit = MAX_TEXT_BYTES,
): Promise<string | null> {
  return (await readTagged(url, doFetch, limit))?.text ?? null;
}

/** An ETag as a bare value: the CDN and the store may differ in quotes or a weak marker. */
const bareTag = (etag: string): string => etag.replace(/^W\//, "").replaceAll('"', "");

/**
 * What this process last wrote at each URL by `create` or `replace`, with the ETag the store gave
 * it. A function instance serves request after request, and the next turn of an episode often
 * comes back to the instance that charged the first: it reads its own write here, without the CDN
 * or a copy. Small documents only, and few of them.
 */
const WRITTEN = new Map<string, { etag: string; text: string }>();
const WRITTEN_LIMIT = 32;

/**
 * Wraps `@vercel/blob` with the credentials passed on every call, so it never depends on what
 * happens to be in process.env. Objects are public and at fixed pathnames. Every call has a time
 * limit of its own.
 */
export function createVercelBlobStore(
  credentials: BlobCredentials,
  sdk: BlobSdk,
  doFetch: BlobFetch,
  written: Map<string, { etag: string; text: string }> = WRITTEN,
): NarrateBlobStore {
  const write = async (
    pathname: string,
    body: Uint8Array | string,
    options: BlobWriteOptions,
    allowOverwrite: boolean,
    ifMatch?: string,
    remember = false,
  ): Promise<{ url: string }> => {
    const result = await withLimit(options.timeoutMs ?? BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
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
          ...(ifMatch === undefined ? {} : { ifMatch }),
          ...credentials,
          abortSignal,
        },
      ),
    );
    if (remember && typeof body === "string" && result.etag) {
      if (written.size >= WRITTEN_LIMIT) written.clear();
      written.set(result.url, { etag: result.etag, text: body });
    }
    return result;
  };

  /**
   * The current version by a URL nobody has asked for: a copy the store makes from itself, read
   * once and deleted. The CDN has never cached that path, so it has to fetch what the store holds.
   */
  const readThroughCopy = async (entry: BlobEntry): Promise<string> => {
    const copied = await withLimit(BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
      sdk.copy(entry.url, `reads/${entry.pathname}`, {
        access: "public",
        addRandomSuffix: true,
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...credentials,
        abortSignal,
      }),
    );
    try {
      const read = await readTagged(copied.url, doFetch, MAX_TEXT_BYTES);
      if (read === null) throw new Error(`${entry.pathname}: its fresh copy could not be read`);
      return read.text;
    } finally {
      // shortcut: a copy whose delete fails, or whose copy call timed out after it landed, stays
      // under reads/; it holds what the public document holds. Sweep reads/ if they pile up.
      // The answer does not wait on the delete; the platform keeps the function alive for it.
      const cleanup = withLimit(BLOB_CALL_TIMEOUT_MS, (abortSignal) =>
        sdk.del(copied.url, { ...credentials, abortSignal }),
      ).catch(() => undefined);
      try {
        waitUntil(cleanup);
      } catch {
        // Not on Vercel: the promise runs on its own.
      }
    }
  };

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

    async textOf(entry) {
      const own = written.get(entry.url);
      if (own && entry.etag !== null && bareTag(own.etag) === bareTag(entry.etag)) return own.text;
      const cdn = await readTagged(entry.url, doFetch, MAX_TEXT_BYTES);
      // With no ETag from the store there is nothing to compare: the CDN's copy is all there is.
      if (cdn !== null && entry.etag === null) return cdn.text;
      if (cdn?.etag && entry.etag && bareTag(cdn.etag) === bareTag(entry.etag)) return cdn.text;
      // The CDN still holds an older copy, or none: up to a minute after an overwrite (2026-11-04).
      return readThroughCopy(entry);
    },

    async put(pathname, body, options) {
      const result = await write(pathname, body, options, true);
      return { url: result.url };
    },

    async replace(pathname, body, options, etag) {
      try {
        await write(pathname, body, options, true, etag, true);
        return true;
      } catch (error) {
        if (error instanceof (await sdkErrors()).BlobPreconditionFailedError) return false;
        throw error;
      }
    },

    async create(pathname, body, options) {
      try {
        await write(pathname, body, options, false, undefined, true);
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
