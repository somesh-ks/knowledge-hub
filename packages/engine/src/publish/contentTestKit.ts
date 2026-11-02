import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BlobPreconditionFailedError } from "@vercel/blob";
import type { ConditionalBlobClient } from "./blob.js";
import { CONTENT_MANIFEST_KEY } from "./contentSync.js";

/** Test helpers for the content store: an in-memory Blob store with ETags, and a scratch checkout. */

export const BASE = "https://store.public.blob.example";
/** An in-memory Blob store with ETags, and a hook that runs before a manifest write. */
export function fakeBlob(beforeManifestWrite?: () => void) {
  const objects = new Map<string, { text: string; etag: number }>();
  let etag = 0;
  const client: ConditionalBlobClient = {
    async put(pathname, body, options) {
      if (pathname === CONTENT_MANIFEST_KEY) beforeManifestWrite?.();
      const current = objects.get(pathname);
      if (options.ifMatch !== undefined && options.ifMatch !== String(current?.etag)) {
        throw new BlobPreconditionFailedError();
      }
      etag += 1;
      objects.set(pathname, { text: new TextDecoder().decode(body), etag });
      return { url: `${BASE}/${pathname}`, pathname };
    },
    async head(pathname) {
      const found = objects.get(pathname);
      return found ? { url: `${BASE}/${pathname}`, etag: String(found.etag) } : null;
    },
    async del(pathnames) {
      for (const name of pathnames) objects.delete(name);
    },
    async list({ prefix }) {
      const blobs = [...objects.keys()]
        .filter((pathname) => pathname.startsWith(prefix))
        .map((pathname) => ({
          url: `${BASE}/${pathname}`,
          pathname,
          uploadedAt: new Date(0),
          size: 0,
        }));
      return { blobs, hasMore: false };
    },
  };
  const fetchText = async (url: string): Promise<string | null> =>
    objects.get(new URL(url).pathname.slice(1))?.text ?? null;
  const manifest = (): Record<string, string> =>
    JSON.parse(objects.get(CONTENT_MANIFEST_KEY)?.text ?? '{"files":{}}').files;
  return { client, objects, fetchText, manifest };
}

export async function checkout(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "content-delta-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}
