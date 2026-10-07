import type { BlobEntry, BlobWriteOptions, NarrateBlobStore } from "../server/blobStore";

/**
 * An in-memory Blob store for the narrate tests. It records every call in order, counts what each
 * would cost on Vercel, can be told to fail or to hang, and can stand in for the CDN in front of
 * the store, which answers a URL it has seen before from its cache.
 */
export type BlobOp = "head" | "fetch" | "put" | "create" | "del";

export interface BlobCall {
  op: BlobOp;
  /** The pathname; for a fetch, the pathname in the URL. */
  pathname: string;
}

/** What the calls so far would be billed as. Deletes and cached reads are free. */
export interface OperationCount {
  advanced: number;
  simple: number;
  free: number;
}

export interface FakeBlobOptions {
  /**
   * Behave like the CDN: remember what each exact URL returned and answer the same again, even
   * after the object behind it has changed. Off, every read by URL is current.
   */
  cdn?: boolean;
}

export interface FakeBlobStore extends NarrateBlobStore {
  /** Every call, in order, whether or not it succeeded. */
  calls: BlobCall[];
  /** Puts an object in place as if it had been uploaded at `uploadedAt` (default: now). */
  seed(pathname: string, body: string | Uint8Array, uploadedAt?: number): void;
  has(pathname: string): boolean;
  /** Every stored pathname under a prefix. Not a store call: it costs nothing and is not recorded. */
  paths(prefix: string): string[];
  text(pathname: string): string | null;
  bytes(pathname: string): Uint8Array | null;
  /** The plain public URL of an object, with no version in it. */
  url(pathname: string): string;
  /** The options the object was last written with. */
  written(pathname: string): BlobWriteOptions | undefined;
  /** The writes and deletes that took effect, in order, as "put audio/x.mp3". */
  changes(): string[];
  operations(): OperationCount;
  /** Makes the next `times` calls of one kind fail, optionally only under a pathname prefix. */
  failNext(op: BlobOp, times: number, options?: { prefix?: string; error?: Error }): void;
  /** Makes the next call of one kind never answer, optionally only under a pathname prefix. */
  hangNext(op: BlobOp, options?: { prefix?: string }): void;
}

export const FAKE_BLOB_HOST = "https://teststore.public.blob.vercel-storage.com";

interface Stored {
  body: Uint8Array;
  uploadedAt: number;
  version: string;
  options?: BlobWriteOptions;
}

interface Trap {
  op: BlobOp;
  prefix: string;
  left: number;
  /** Null means: never answer. */
  error: Error | null;
}

const toBytes = (body: string | Uint8Array): Uint8Array =>
  typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);

export function createFakeBlobStore(
  now: () => number,
  options: FakeBlobOptions = {},
): FakeBlobStore {
  const objects = new Map<string, Stored>();
  const cdn = new Map<string, string | null>();
  const calls: BlobCall[] = [];
  const changes: string[] = [];
  const traps: Trap[] = [];
  const count: OperationCount = { advanced: 0, simple: 0, free: 0 };
  let writes = 0;

  const urlOf = (pathname: string): string => `${FAKE_BLOB_HOST}/${pathname}`;
  const entry = (pathname: string, stored: Stored): BlobEntry => ({
    pathname,
    url: urlOf(pathname),
    uploadedAt: stored.uploadedAt,
    size: stored.body.byteLength,
    version: stored.version,
    etag: `"${stored.version}"`,
  });
  const store = (pathname: string, body: string | Uint8Array, uploadedAt: number): Stored => {
    writes += 1;
    const stored: Stored = { body: toBytes(body), uploadedAt, version: `v${writes}` };
    objects.set(pathname, stored);
    return stored;
  };

  /** Records the call, then fails or hangs it when a matching trap is still armed. */
  async function begin(op: BlobOp, pathname: string): Promise<void> {
    calls.push({ op, pathname });
    const trap = traps.find(
      (candidate) =>
        candidate.op === op && candidate.left > 0 && pathname.startsWith(candidate.prefix),
    );
    if (!trap) return;
    trap.left -= 1;
    if (trap.error === null) await new Promise<never>(() => {});
    throw trap.error;
  }

  return {
    calls,
    async head(pathname) {
      count.simple += 1;
      await begin("head", pathname);
      const stored = objects.get(pathname);
      return stored ? entry(pathname, stored) : null;
    },
    async fetchText(url) {
      const pathname = decodeURIComponent(new URL(url).pathname.slice(1));
      const cached = options.cdn === true && cdn.has(url);
      if (cached) count.free += 1;
      else count.simple += 1;
      await begin("fetch", pathname);
      if (cached) return cdn.get(url) ?? null;
      const stored = objects.get(pathname);
      const text = stored ? new TextDecoder().decode(stored.body) : null;
      if (options.cdn === true) cdn.set(url, text);
      return text;
    },
    async put(pathname, body, writeOptions) {
      count.advanced += 1;
      await begin("put", pathname);
      store(pathname, body, now()).options = writeOptions;
      changes.push(`put ${pathname}`);
      return { url: urlOf(pathname) };
    },
    async create(pathname, body, writeOptions) {
      count.advanced += 1;
      await begin("create", pathname);
      if (objects.has(pathname)) return false;
      store(pathname, body, now()).options = writeOptions;
      changes.push(`create ${pathname}`);
      return true;
    },
    async del(pathname) {
      count.free += 1;
      await begin("del", pathname);
      if (objects.delete(pathname)) changes.push(`del ${pathname}`);
    },
    async delIfUnchanged(target) {
      count.free += 1;
      await begin("del", target.pathname);
      // Only the very object that was read: one that was replaced since has another version.
      if (objects.get(target.pathname)?.version !== target.version) return false;
      objects.delete(target.pathname);
      changes.push(`del ${target.pathname}`);
      return true;
    },
    paths: (prefix) => [...objects.keys()].filter((pathname) => pathname.startsWith(prefix)),
    seed(pathname, body, uploadedAt = now()) {
      store(pathname, body, uploadedAt);
    },
    has: (pathname) => objects.has(pathname),
    text(pathname) {
      const stored = objects.get(pathname);
      return stored ? new TextDecoder().decode(stored.body) : null;
    },
    bytes: (pathname) => objects.get(pathname)?.body ?? null,
    url: urlOf,
    written: (pathname) => objects.get(pathname)?.options,
    changes: () => [...changes],
    operations: () => ({ ...count }),
    failNext(op, times, trapOptions = {}) {
      traps.push({
        op,
        prefix: trapOptions.prefix ?? "",
        left: times,
        error: trapOptions.error ?? new Error(`fake blob ${op} failed`),
      });
    },
    hangNext(op, trapOptions = {}) {
      traps.push({ op, prefix: trapOptions.prefix ?? "", left: 1, error: null });
    },
  };
}
