import { del, head, put } from "@vercel/blob";
import { loadSite } from "../src/lib/site";
import { createVercelBlobStore } from "../src/server/blobStore";
import { readBlobCredentials, readPublicBlobBase } from "../src/server/config";
import { COVERS_INDEX_KEY, storeCovers } from "../src/server/storeCovers";

/**
 * Draws the covers the content store's briefings and episodes need (D173). content.yml runs it
 * after `singularity content sync`, on the same checkout, so it sees what the sync just sent.
 *
 * Usage: npx tsx apps/web/scripts/storeCovers.ts (BLOB_READ_WRITE_TOKEN set)
 */

const credentials = readBlobCredentials(process.env);
const base = readPublicBlobBase(process.env);
if (!credentials || !base) {
  console.error("storeCovers: BLOB_READ_WRITE_TOKEN is not set");
  process.exit(1);
}
const store = createVercelBlobStore(credentials, { head, put, del }, fetch);
const drawn = await storeCovers({
  site: await loadSite(),
  base,
  fetch,
  put: async (pathname, body, contentType) => {
    // A cover address carries its record's version (?v=), so a cover never changes under it. The
    // index does change.
    await store.put(pathname, body, {
      contentType,
      cacheSeconds: pathname === COVERS_INDEX_KEY ? 60 : 31_536_000,
    });
  },
  now: Date.now,
});
console.log(drawn.length === 0 ? "covers: none to draw" : `covers: drew ${drawn.join(", ")}`);
