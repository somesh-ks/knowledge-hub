import { del, head, put } from "@vercel/blob";
import { SHAREABLE_KINDS } from "../lib/share";
import type { NarrateLookupResponse } from "../types/contracts";
import { createVercelBlobStore } from "./blobStore";
import { readBlobCredentials, readPublicBlobBase, type ServerEnv, withSecondVoice } from "./config";
import { guardedDatabase } from "./database";
import { bundledDigests } from "./digestSource";
import { bundledEpisodes } from "./episodeSource";
import { handleNarrationLookup, isEpisodeId } from "./narrate";
import { burstCap } from "./rateLimit";
import {
  createNotStoredMemo,
  type MakeDeps,
  type ShareCandidate,
  type ShareDeps,
  shareCandidates,
} from "./share";

/**
 * The share routes' and the listen page's real dependencies: Neon through the guarded call, the
 * shared per-minute caps (D150, one bucket per route), the bundled digests and episodes, and Blob.
 */

/** Make and stop, all items together: the owner shares a few a day. */
const SHARE_MAKES_PER_MINUTE = 10;
/** Play starts on every listen page together; a listener presses Play once per listen. */
const SHARE_PLAYS_PER_MINUTE = 30;
/** Listen page renders that miss the CDN's five-minute copy. */
const LISTEN_PAGES_PER_MINUTE = 60;
/** A listener waits on these, but Neon may be waking: longer than the counter's 1 s. */
const SHARE_DATABASE_TIMEOUT_MS = 4_000;

const log = (message: string): void => console.error(`[share] ${message}`);

const database = guardedDatabase({
  databaseUrl: process.env.DATABASE_URL,
  timeoutMs: SHARE_DATABASE_TIMEOUT_MS,
  log: (message) => log(`store ${message}`),
});

/** Per function instance: a Share retried on half-stored audio heads nothing for a while. */
const notStored = createNotStoredMemo();

function base(bucket: string, perMinute: number): ShareDeps {
  const env = process.env as ServerEnv;
  return {
    database,
    burst: burstCap(bucket, perMinute),
    now: Date.now,
    candidates: (itemId) => candidatesFor(env, itemId),
    log,
  };
}

/** The item's files, as the narration lookup names them; no store operation. */
async function candidatesFor(env: ServerEnv, itemId: string): Promise<ShareCandidate[] | null> {
  const kind = isEpisodeId(itemId) ? "episode" : "briefing";
  if (!(SHAREABLE_KINDS as readonly string[]).includes(kind)) return null;
  // No live episodes: one still being written is never wholly stored.
  const lookup = await handleNarrationLookup(
    { digest: itemId, params: ["digest"] },
    { env: withSecondVoice(env), digests: bundledDigests, episodes: bundledEpisodes, log },
  );
  return shareCandidates(lookup.body as NarrateLookupResponse, readPublicBlobBase(env));
}

/** POST and DELETE /api/share. */
export function makeDeps(requestOidcToken: () => string | null): MakeDeps {
  const env = process.env as ServerEnv;
  const credentials = readBlobCredentials(env, requestOidcToken);
  const store = credentials ? createVercelBlobStore(credentials, { head, put, del }, fetch) : null;
  return {
    ...base("share", SHARE_MAKES_PER_MINUTE),
    head: store ? (pathname) => store.head(pathname) : null,
    notStored,
  };
}

/** POST /api/share-play. */
export const playDeps = (): ShareDeps => base("share-play", SHARE_PLAYS_PER_MINUTE);

/** The listen page, /s/<token>. */
export const listenDeps = (): ShareDeps => base("share-page", LISTEN_PAGES_PER_MINUTE);
