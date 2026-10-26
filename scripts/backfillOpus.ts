// Adds the Opus narrations (WebM and MP4) beside the MP3 of every published digest that lacks them (plan 19.1).
// Usage: npm run backfill:opus [-- --apply]   Without --apply it lists what it would do and writes nothing.
// Needs ffmpeg on the PATH and BLOB_READ_WRITE_TOKEN (or VERCEL_OIDC_TOKEN with BLOB_STORE_ID) in the environment.
// MP3s are never deleted or changed; each record gains webm_url and m4a_url, nothing else.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDigestFile, serializeDigestFile } from "@singularity/core";
import { writeTextAtomic } from "../packages/engine/src/audio/atomicFile.js";
import {
  OPUS_CONTAINERS,
  type OpusContainer,
  transcodeToOpus,
} from "../packages/engine/src/audio/transcode.js";
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
  if (!digest.audio) continue;
  const missing = OPUS_CONTAINERS.filter(
    (container) => !digest.audio?.[container === "webm" ? "webm_url" : "m4a_url"],
  );
  if (missing.length === 0) continue;
  todo++;
  console.log(`${apply ? "transcode" : "would transcode"} ${target.id}: ${missing.join(", ")}`);
  if (!client) continue;

  const response = await fetch(digest.audio.url);
  if (!response.ok) {
    console.error(`  skipped, the MP3 answered ${response.status}`);
    continue;
  }
  const mp3 = new Uint8Array(await response.arrayBuffer());
  const urls: Partial<Record<OpusContainer, string>> = {};
  for (const container of missing) {
    try {
      urls[container] = await uploadOpusAudio(client, {
        digestId: target.id,
        container,
        audio: await transcodeToOpus(mp3, container),
      });
    } catch (error) {
      console.error(`  ${container} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (!urls.webm && !urls.m4a) continue;
  await writeTextAtomic(
    path,
    serializeDigestFile({
      ...digest,
      audio: {
        ...digest.audio,
        ...(urls.webm ? { webm_url: urls.webm } : {}),
        ...(urls.m4a ? { m4a_url: urls.m4a } : {}),
      },
    }),
  );
  done++;
}

console.log(
  apply
    ? `Backfilled ${done} of ${todo} digests. Commit the changed Digests/ files through the write guard.`
    : `${todo} digests lack Opus. Dry run: nothing written. Run with --apply to write.`,
);
