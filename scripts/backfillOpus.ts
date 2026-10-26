// Adds the Opus narration (MP4, .m4a) beside the MP3 of every published digest that lacks it (plan 19.1).
// Usage: npm run backfill:opus [-- --apply]   Without --apply it lists what it would do and writes nothing.
// Needs ffmpeg on the PATH and BLOB_READ_WRITE_TOKEN (or VERCEL_OIDC_TOKEN with BLOB_STORE_ID) in the environment.
// MP3s are never deleted or changed; each record gains m4a_url, nothing else. Podcast episodes are narrated
// per turn as MP3 segments and are not transcoded (see the PR).
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDigestFile, serializeDigestFile } from "@singularity/core";
import { writeTextAtomic } from "../packages/engine/src/audio/atomicFile.js";
import { transcodeToOpus } from "../packages/engine/src/audio/transcode.js";
import { createVercelBlobClient, uploadOpusAudio } from "../packages/engine/src/publish/blob.js";
import { listDigestTargets } from "../packages/engine/src/publish/publishAudio.js";

const apply = process.argv.includes("--apply");
const root = resolve(import.meta.dirname, "..");

function blobClient() {
  const {
    BLOB_READ_WRITE_TOKEN: token,
    VERCEL_OIDC_TOKEN: oidcToken,
    BLOB_STORE_ID: storeId,
  } = process.env;
  if (token) return createVercelBlobClient(token);
  if (oidcToken && storeId) return createVercelBlobClient({ oidcToken, storeId });
  throw new Error("Set BLOB_READ_WRITE_TOKEN (or VERCEL_OIDC_TOKEN with BLOB_STORE_ID).");
}

const client = apply ? blobClient() : null;
let todo = 0;
let done = 0;

for (const target of await listDigestTargets(root)) {
  const path = join(root, target.relPath);
  const digest = parseDigestFile(await readFile(path, "utf8"));
  if (!digest.audio || digest.audio.m4a_url) continue;
  todo++;
  console.log(`${apply ? "transcode" : "would transcode"} ${target.id}`);
  if (!client) continue;

  try {
    const response = await fetch(digest.audio.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      console.error(`  skipped, the MP3 answered ${response.status}`);
      continue;
    }
    const m4aUrl = await uploadOpusAudio(client, {
      digestId: target.id,
      audio: await transcodeToOpus(new Uint8Array(await response.arrayBuffer())),
    });
    await writeTextAtomic(
      path,
      serializeDigestFile({ ...digest, audio: { ...digest.audio, m4a_url: m4aUrl } }),
    );
    done++;
  } catch (error) {
    console.error(`  failed: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(
  apply
    ? `Backfilled ${done} of ${todo} digests. Commit the changed Digests/ files through the write guard.`
    : `${todo} digests lack Opus. Dry run: nothing written. Run with --apply to write.`,
);
