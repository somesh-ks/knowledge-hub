import { del, get, list, put } from "@vercel/blob";
import type { SnapshotStore } from "../store/configSnapshot.js";
import { SNAPSHOT_PREFIX } from "../store/configSnapshot.js";

/**
 * The config snapshots in a PRIVATE Vercel Blob store (D300). A store is public or private as a
 * whole, and the content store (audio, digests) is public, so snapshots need a store of their own and
 * its own token, BLOB_PRIVATE_READ_WRITE_TOKEN: a private blob is read only with that token.
 */
export function createPrivateSnapshotStore(token: string): SnapshotStore {
  return {
    async put(key, text) {
      await put(key, text, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        token,
      });
    },
    async read(key) {
      const result = await get(key, { access: "private", token });
      if (result === null || result.statusCode !== 200) return null;
      return await new Response(result.stream).text();
    },
    async keys() {
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: SNAPSHOT_PREFIX, token, ...(cursor ? { cursor } : {}) });
        names.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return names;
    },
    async del(keys) {
      if (keys.length > 0) await del([...keys], { token });
    },
  };
}
