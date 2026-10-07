import type { BlobEntry, BlobWriteOptions, NarrateBlobStore } from "../server/blobStore";

/**
 * An in-memory Blob store for the narrate tests. It records every call in order, so a test can
 * assert what was written and when, and it can be told to fail, so the retry and give-up paths run
 * without a network.
 */
export type BlobOp = "head" | "read" | "list" | "put" | "del";

export interface BlobCall {
  op: BlobOp;
  pathname: string;
}

export interface FakeBlobStore extends NarrateBlobStore {
  /** Every call, in order. A listing records its prefix as the pathname. */
  calls: BlobCall[];
  /** Puts an object in place as if it had been uploaded at `uploadedAt` (default: now). */
  seed(pathname: string, body: string | Uint8Array, uploadedAt?: number): void;
  has(pathname: string): boolean;
  text(pathname: string): string | null;
  bytes(pathname: string): Uint8Array | null;
  /** The options the object was last written with. */
  written(pathname: string): BlobWriteOptions | undefined;
  /** The writes and deletes, in order, as "put audio/x.mp3". */
  changes(): string[];
  /** Makes the next `times` calls of one kind fail, optionally only under a pathname prefix. */
  failNext(op: BlobOp, times: number, options?: { prefix?: string; error?: Error }): void;
}

export const FAKE_BLOB_HOST = "https://teststore.public.blob.vercel-storage.com";

interface Stored {
  body: Uint8Array;
  uploadedAt: number;
  options?: BlobWriteOptions;
}

interface Failure {
  op: BlobOp;
  prefix: string;
  left: number;
  error: Error;
}

const toBytes = (body: string | Uint8Array): Uint8Array =>
  typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);

export function createFakeBlobStore(now: () => number): FakeBlobStore {
  const objects = new Map<string, Stored>();
  const calls: BlobCall[] = [];
  const failures: Failure[] = [];

  const entry = (pathname: string, stored: Stored): BlobEntry => ({
    pathname,
    url: `${FAKE_BLOB_HOST}/${pathname}`,
    uploadedAt: stored.uploadedAt,
  });

  /** Records the call, then fails it when a matching failure is still armed. */
  function begin(op: BlobOp, pathname: string): void {
    calls.push({ op, pathname });
    const failure = failures.find(
      (candidate) =>
        candidate.op === op && candidate.left > 0 && pathname.startsWith(candidate.prefix),
    );
    if (!failure) return;
    failure.left -= 1;
    throw failure.error;
  }

  return {
    calls,
    async head(pathname) {
      begin("head", pathname);
      const stored = objects.get(pathname);
      return stored ? entry(pathname, stored) : null;
    },
    async readText(pathname) {
      begin("read", pathname);
      const stored = objects.get(pathname);
      return stored ? new TextDecoder().decode(stored.body) : null;
    },
    async list(prefix) {
      begin("list", prefix);
      return [...objects.entries()]
        .filter(([pathname]) => pathname.startsWith(prefix))
        .map(([pathname, stored]) => entry(pathname, stored));
    },
    async put(pathname, body, options) {
      begin("put", pathname);
      const stored: Stored = { body: toBytes(body), uploadedAt: now(), options };
      objects.set(pathname, stored);
      return { url: entry(pathname, stored).url };
    },
    async del(pathname) {
      begin("del", pathname);
      objects.delete(pathname);
    },
    seed(pathname, body, uploadedAt = now()) {
      objects.set(pathname, { body: toBytes(body), uploadedAt });
    },
    has: (pathname) => objects.has(pathname),
    text(pathname) {
      const stored = objects.get(pathname);
      return stored ? new TextDecoder().decode(stored.body) : null;
    },
    bytes: (pathname) => objects.get(pathname)?.body ?? null,
    written: (pathname) => objects.get(pathname)?.options,
    changes: () =>
      calls
        .filter((call) => call.op === "put" || call.op === "del")
        .map((call) => `${call.op} ${call.pathname}`),
    failNext(op, times, options = {}) {
      failures.push({
        op,
        prefix: options.prefix ?? "",
        left: times,
        error: options.error ?? new Error(`fake blob ${op} failed`),
      });
    },
  };
}
