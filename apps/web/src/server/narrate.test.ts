import { AudioTimeline, type Digest, serializeDigestFile } from "@dispatch/core";
import { hashPassphrase, verifyPassphrase } from "@dispatch/core/passphrase";
import { buildSpokenText, type SpokenSegment, spokenSegments } from "@dispatch/engine/audio";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDigest, makeItem, makeTimeline } from "../testing/digestFactory";
import { createFakeBlobStore, FAKE_BLOB_HOST } from "../testing/fakeBlobStore";
import {
  createFakeSpeechify,
  FAKE_AUDIO,
  FAKE_PLAIN_AUDIO,
  type FakeSpeechMode,
  MS_PER_WORD,
  wordMarks,
} from "../testing/fakeSpeechify";
import { type BlobCredentials, MS_PER_CHARACTER, type ServerEnv } from "./config";
import { SYNTHESIS_DEADLINE_MS } from "./functionLimits.mjs";
import { WRONG_PASSPHRASE_DELAY_MS } from "./generate";
import type { ApiResult } from "./http";
import { NARRATE_DAILY_CAP } from "./limits";
import {
  audioKey,
  type DigestSource,
  handleNarrate,
  handleNarrationLookup,
  MARKER_TTL_MS,
  markerKey,
  type NarrateBody,
  type NarrateDeps,
  parseDigestId,
  parseNarrateRequest,
  startDeadline,
  timelineKey,
  UPLOAD_ATTEMPTS,
  UPLOAD_RETRY_DELAY_MS,
  usageKey,
} from "./narrate";
import { segmentHash, segmentPath, slotKey } from "./narrateSegments";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const HOUR = 3_600_000;
const ORIGIN = "https://news.someshks.work";
const ID = "2026-10-07";
const MONTH = "2026-10";
const PASSPHRASE = "correct horse battery staple";
const SPEECHIFY_KEY = "speechify-test-key-8f3a9c1e2b7d";
const BLOB_TOKEN = "vercel_blob_rw_TestStore1234abcd_0123456789abcdefghij";
/** Text only an upstream service would say. It must never reach a caller. */
const UPSTREAM = "UPSTREAM-DETAIL-4c1f";

let passphraseHash = "";

beforeAll(async () => {
  passphraseHash = await hashPassphrase(PASSPHRASE);
});

interface FakeDigests extends DigestSource {
  timelines: Map<string, unknown>;
}

function fakeDigests(digests: Digest[]): FakeDigests {
  const files = new Map(digests.map((digest) => [digest.id, serializeDigestFile(digest)]));
  const timelines = new Map<string, unknown>();
  return {
    timelines,
    readDigest: async (id) => files.get(id) ?? null,
    readTimeline: async (id) => timelines.get(id) ?? null,
  };
}

interface SetupOptions {
  env?: ServerEnv;
  speech?: FakeSpeechMode;
  digests?: Digest[];
  overrides?: Partial<NarrateDeps>;
}

function setup(options: SetupOptions = {}) {
  let clock = NOW;
  const digest = makeDigest({ id: ID });
  const blob = createFakeBlobStore(() => clock);
  const speech = createFakeSpeechify(options.speech);
  const digests = fakeDigests(options.digests ?? [digest]);
  const delays: number[] = [];
  const logs: string[] = [];
  const opened: BlobCredentials[] = [];
  const deadline = new AbortController();
  const deadlines: number[] = [];
  const state = { cancelled: 0 };
  const deps: NarrateDeps = {
    env: {
      GENERATE_PASSPHRASE_HASH: passphraseHash,
      SPEECHIFY_API_KEY: SPEECHIFY_KEY,
      BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
      ...options.env,
    },
    fetch: speech.fetch,
    now: () => clock,
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
    verifyPassphrase,
    openBlob: (credentials) => {
      opened.push(credentials);
      return blob;
    },
    digests,
    startDeadline: (milliseconds) => {
      deadlines.push(milliseconds);
      return {
        signal: deadline.signal,
        cancel: () => {
          state.cancelled += 1;
        },
      };
    },
    log: (message) => logs.push(message),
    ...options.overrides,
  };
  return {
    deps,
    digest,
    blob,
    speech,
    digests,
    delays,
    logs,
    opened,
    deadline,
    deadlines,
    state,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

type Setup = ReturnType<typeof setup>;

const body = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ digest: ID, passphrase: PASSPHRASE, ...fields });
const input = (bodyText: string = body(), origin: string | null = ORIGIN) => ({
  bodyText,
  origin,
  expectedOrigin: ORIGIN,
});
const post = (context: Setup, bodyText?: string) => handleNarrate(input(bodyText), context.deps);
const lookup = (context: Setup, digest: string | null = ID) =>
  handleNarrationLookup({ digest }, context.deps);

/** Puts a finished narration in the store, as a successful POST would have left it. */
function seedNarration(context: Setup, uploadedAt = NOW - HOUR) {
  const timeline = makeTimeline(context.digest);
  context.blob.seed(audioKey(ID), FAKE_AUDIO, uploadedAt);
  context.blob.seed(timelineKey(ID), JSON.stringify(timeline), uploadedAt);
  return timeline;
}

const usage = (characters: number) =>
  JSON.stringify({ version: 1, speechify: { month: MONTH, characters } });

const timeoutReason = () => new DOMException("deadline", "TimeoutError");

/** The engine's default voice and model, which the segment file names are hashed with. */
const VOICE = "geffen_32";
const MODEL = "simba-3.2";

type Result = ApiResult<NarrateBody>;

function segmentOf(digest: Digest, key: string): SpokenSegment {
  const segment = spokenSegments(digest).find((candidate) => candidate.key === key);
  if (!segment) throw new Error(`the digest has no segment ${key}`);
  return segment;
}

/** The key of the nth story in spoken order (0 is the first story, after the intro). */
const storyKey = (digest: Digest, index: number): string =>
  spokenSegments(digest).filter((segment) => segment.itemId !== null)[index]?.key ?? "";

interface SeedSegmentOptions {
  durationMs?: number;
  uploadedAt?: number;
  /** Text the file was made from, when it is not the segment's current text. */
  text?: string;
  voice?: string;
}

/** Puts a narrated segment in the store, named as a successful POST would have named it. */
function seedSegment(context: Setup, key: string, options: SeedSegmentOptions = {}) {
  const segment = segmentOf(context.digest, key);
  const durationMs = options.durationMs ?? 1500;
  const hash = segmentHash(options.text ?? segment.text, options.voice ?? VOICE, MODEL);
  const path = segmentPath(ID, key, hash, durationMs);
  context.blob.seed(path, FAKE_AUDIO, options.uploadedAt ?? NOW - HOUR);
  return { path, segment, audio: { url: `${FAKE_BLOB_HOST}/${path}`, duration_ms: durationMs } };
}

/** A slot is what a digest holds under the daily cap once anything was narrated for it. */
const seedSlot = (context: Setup, digest: string, uploadedAt: number) =>
  context.blob.seed(slotKey(digest), "{}", uploadedAt);

function lookupBody(result: Result) {
  if (result.body.status !== 200 || !("segments" in result.body)) {
    throw new Error(`expected a lookup, got ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

function wholeBody(result: Result) {
  if (result.body.status !== 200 || !("timeline" in result.body) || "segments" in result.body) {
    throw new Error(`expected a whole-digest narration, got ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

function segmentBody(result: Result) {
  if (result.body.status !== 200 || !("segment" in result.body)) {
    throw new Error(`expected a narrated segment, got ${JSON.stringify(result.body)}`);
  }
  return result.body.segment;
}

/** Asserts that neither the answer nor the log carries a secret, and the answer carries no upstream text. */
function expectNothingLeaked(result: Result, logs: string[]) {
  const answer = JSON.stringify(result);
  const everything = answer + logs.join("\n");
  for (const secret of [SPEECHIFY_KEY, BLOB_TOKEN, passphraseHash, PASSPHRASE]) {
    expect(everything).not.toContain(secret);
  }
  expect(answer).not.toContain(UPSTREAM);
}

describe("parseDigestId", () => {
  it("accepts the three forms of a digest id", () => {
    for (const id of ["2026-10-07", "2026-10-07-2", "2026-10-11-weekly"]) {
      expect(parseDigestId(id)).toBe(id);
    }
  });

  it("rejects everything else", () => {
    for (const bad of [
      null,
      undefined,
      7,
      "",
      "latest",
      "2026-10-7",
      "2026-10-07-1",
      "../2026-10-07",
      "2026-10-07/../../state",
      "2026-10-07.mp3",
      ` ${ID}`,
      `2026-10-07-${"9".repeat(40)}`,
    ]) {
      expect(parseDigestId(bad)).toBeNull();
    }
  });
});

describe("parseNarrateRequest", () => {
  it("reads the digest and the passphrase from a JSON body", () => {
    expect(parseNarrateRequest(body())).toEqual({ digest: ID, passphrase: PASSPHRASE });
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({ digest: ID }),
      JSON.stringify({ passphrase: PASSPHRASE }),
      body({ passphrase: "" }),
      body({ passphrase: 42 }),
      body({ digest: "everything" }),
      body({ digest: 20261007 }),
      body({ passphrase: "x".repeat(257) }),
      body({ pad: "y".repeat(2048) }),
    ]) {
      expect(parseNarrateRequest(bad)).toBeNull();
    }
  });

  it("reads an optional segment key", () => {
    for (const segment of ["intro", "outro", "00000000000a"]) {
      expect(parseNarrateRequest(body({ segment }))).toEqual({
        digest: ID,
        passphrase: PASSPHRASE,
        segment,
      });
    }
  });

  it("rejects a segment that is sent but is not a key, instead of narrating the whole digest", () => {
    for (const segment of [
      null,
      "",
      7,
      true,
      ["intro"],
      "../intro",
      "Intro",
      "a.b",
      "x".repeat(33),
    ]) {
      expect(parseNarrateRequest(body({ segment }))).toBeNull();
    }
  });
});

describe("GET /api/narrate", () => {
  it("answers 400 for a missing or malformed digest id, without opening the store", async () => {
    const context = setup();
    for (const bad of [null, "", "latest", "../x"]) {
      expect(await lookup(context, bad)).toEqual({
        status: 400,
        body: { status: 400, error: "invalid_request" },
      });
    }
    expect(context.opened).toHaveLength(0);
  });

  it("answers 400 before reading any configuration, as the static build needs", async () => {
    const requestOidcToken = vi.fn(() => "token");
    const context = setup({ env: { BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: "store_x" } });
    const result = await handleNarrationLookup({ digest: null, requestOidcToken }, context.deps);
    expect(result.status).toBe(400);
    expect(requestOidcToken).not.toHaveBeenCalled();
  });

  it("answers 503 when the store is not configured", async () => {
    const context = setup({ env: { BLOB_READ_WRITE_TOKEN: undefined } });
    expect(await lookup(context)).toEqual({
      status: 503,
      body: { status: 503, error: "unavailable" },
    });
    expect(context.opened).toHaveLength(0);
  });

  it("answers 503 when the configured voice is unusable, since segment files are keyed by it", async () => {
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "two words" } });
    expect((await lookup(context)).status).toBe(503);
    expect(context.opened).toHaveLength(0);
  });

  it("lists every segment of a digest nothing was narrated for, with one store call", async () => {
    const context = setup();
    const spoken = spokenSegments(context.digest);
    const result = await lookup(context);

    expect(result.headers).toBeUndefined();
    expect(result).toEqual({
      status: 200,
      body: {
        status: 200,
        audio: null,
        timeline: null,
        segments: spoken.map((segment) => ({
          key: segment.key,
          item_id: segment.itemId,
          characters: segment.text.length,
          audio: null,
        })),
        ms_per_character: MS_PER_CHARACTER,
      },
    });
    // The intro, then the four stories in the order they are spoken.
    expect(lookupBody(result).segments.map((segment) => segment.key)).toEqual([
      "intro",
      ...buildSpokenText(context.digest).ranges.map((range) => range.id),
    ]);
    expect(lookupBody(result).segments[0]?.item_id).toBeNull();
    expect(context.blob.calls).toEqual([{ op: "list", pathname: `audio/${ID}` }]);
  });

  it("answers 404 for a digest this deployment does not have, without a store call", async () => {
    const context = setup();
    // Even audio that exists is not looked up: only a digest with a page here can cost a call.
    context.blob.seed(audioKey("2026-10-09"), FAKE_AUDIO);
    expect(await lookup(context, "2026-10-09")).toEqual({
      status: 404,
      body: { status: 404, error: "digest_not_found" },
    });
    expect(context.opened).toHaveLength(0);
    expect(context.blob.calls).toEqual([]);
  });

  it("answers 422 for a digest that cannot be read aloud, without a store call", async () => {
    const long = makeDigest({
      id: ID,
      items: [1, 2, 3, 4].map((seed) => makeItem(seed, "top", { summary: "word ".repeat(1200) })),
    });
    const context = setup({ digests: [long] });
    expect((await lookup(context)).status).toBe(422);
    expect(context.blob.calls).toEqual([]);
  });

  it("reads the listing back into segments: which is narrated, where, and how long", async () => {
    const context = setup();
    const intro = seedSegment(context, "intro", { durationMs: 2750 });
    const story = seedSegment(context, storyKey(context.digest, 1), { durationMs: 41_300 });

    const { segments } = lookupBody(await lookup(context));
    expect(segments.find((segment) => segment.key === "intro")?.audio).toEqual(intro.audio);
    expect(intro.audio.url).toMatch(/\/audio\/2026-10-07\/seg\/intro\.[0-9a-f]{12}\.2750\.mp3$/);
    expect(segments.find((segment) => segment.key === story.segment.key)?.audio).toEqual({
      url: story.audio.url,
      duration_ms: 41_300,
    });
    // The other three stories are not narrated yet.
    expect(segments.filter((segment) => segment.audio === null)).toHaveLength(3);
    // Still one call: the names in the listing are the whole record.
    expect(context.blob.calls).toEqual([{ op: "list", pathname: `audio/${ID}` }]);
  });

  it("does not take another text's, voice's or digest's file for a segment", async () => {
    const context = setup();
    const key = storyKey(context.digest, 0);
    // The story as it read before an edit, and the same story in another voice.
    seedSegment(context, key, { text: "An earlier wording of this story." });
    seedSegment(context, key, { voice: "henry_7" });
    // A same-day second digest shares the listing prefix "audio/2026-10-07".
    const intro = segmentOf(context.digest, "intro");
    const hash = segmentHash(intro.text, VOICE, MODEL);
    context.blob.seed(segmentPath("2026-10-07-2", "intro", hash, 1000), FAKE_AUDIO);
    context.blob.seed(audioKey("2026-10-07-2"), FAKE_AUDIO);
    // Names that are not segment names at all.
    context.blob.seed(`audio/${ID}/seg/intro.mp3`, FAKE_AUDIO);
    context.blob.seed(`audio/${ID}/seg/intro.${hash}.0.mp3`, FAKE_AUDIO);
    context.blob.seed(`audio/${ID}/seg/intro.${hash}.1000.wav`, FAKE_AUDIO);
    context.blob.seed(`audio/${ID}/other/intro.${hash}.1000.mp3`, FAKE_AUDIO);

    const body = lookupBody(await lookup(context));
    expect(body.audio).toBeNull();
    expect(body.segments.every((segment) => segment.audio === null)).toBe(true);
  });

  it("finds a segment by the configured voice", async () => {
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "henry_7" } });
    seedSegment(context, "intro", { voice: VOICE });
    expect(lookupBody(await lookup(context)).segments[0]?.audio).toBeNull();
    const narrated = seedSegment(context, "intro", { voice: "henry_7" });
    expect(lookupBody(await lookup(context)).segments[0]?.audio).toEqual(narrated.audio);
  });

  it("names the first upload when a segment was somehow narrated twice", async () => {
    const context = setup();
    seedSegment(context, "intro", { durationMs: 2800, uploadedAt: NOW - 1000 });
    const first = seedSegment(context, "intro", { durationMs: 2750, uploadedAt: NOW - 5000 });
    expect(lookupBody(await lookup(context)).segments[0]?.audio).toEqual(first.audio);
  });

  it("returns the whole-digest audio and its timeline beside the segments", async () => {
    const context = setup();
    const timeline = seedNarration(context);
    const body = lookupBody(await lookup(context));
    expect(body.audio).toEqual({
      url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`,
      duration_ms: timeline.duration_ms,
    });
    expect(body.timeline).toEqual({
      kind: "marks",
      items: timeline.items,
      sections: timeline.sections,
    });
    expect(body.segments).toHaveLength(5);
    // Voice, model and character count are stored but are not the page's business.
    expect(JSON.stringify(body)).not.toContain("text_chars");
    // Only a digest narrated as one file costs the second call, for that file's timeline.
    expect(context.blob.calls).toEqual([
      { op: "list", pathname: `audio/${ID}` },
      { op: "read", pathname: timelineKey(ID) },
    ]);
  });

  it("reports no whole-digest audio when there is an MP3 but no timeline for it", async () => {
    const context = setup();
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    const body = lookupBody(await lookup(context));
    expect(body.audio).toBeNull();
    expect(body.timeline).toBeNull();
  });

  it("needs no passphrase, no Speechify key and spends nothing", async () => {
    const context = setup({
      env: { GENERATE_PASSPHRASE_HASH: undefined, SPEECHIFY_API_KEY: undefined },
    });
    seedNarration(context);
    seedSegment(context, "intro");
    expect((await lookup(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("uses the committed timeline for a digest the audio workflow narrated", async () => {
    const context = setup();
    const timeline = makeTimeline(context.digest);
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    context.digests.timelines.set(ID, timeline);
    const body = lookupBody(await lookup(context));
    expect(body.audio?.duration_ms).toBe(timeline.duration_ms);
  });

  it("ignores a timeline that is malformed or belongs to another digest", async () => {
    const context = setup();
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    context.blob.seed(timelineKey(ID), "{ not json");
    context.digests.timelines.set(ID, { ...makeTimeline(context.digest), digest: "2026-10-06" });
    expect(lookupBody(await lookup(context)).audio).toBeNull();
  });

  it("opens the store with OIDC credentials when there is no read-write token", async () => {
    const context = setup({
      env: { BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: "store_abc123" },
    });
    seedNarration(context);
    const result = await handleNarrationLookup(
      { digest: ID, requestOidcToken: () => "oidc-token-from-the-request" },
      context.deps,
    );
    expect(result.status).toBe(200);
    expect(context.opened).toEqual([
      { oidcToken: "oidc-token-from-the-request", storeId: "store_abc123" },
    ]);
  });

  it("answers 503 when the store fails, with a generic body and a redacted log", async () => {
    const context = setup();
    context.blob.failNext("list", 1, {
      error: new Error(`${UPSTREAM}: forbidden for ${BLOB_TOKEN}`),
    });
    const result = await lookup(context);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(context.logs).toHaveLength(1);
    expect(context.logs[0]).toContain("[redacted]");
    expectNothingLeaked(result, context.logs);
  });
});

describe("POST /api/narrate: who may ask", () => {
  it("answers 503 and touches nothing when the site is not configured", async () => {
    for (const missing of [
      "GENERATE_PASSPHRASE_HASH",
      "SPEECHIFY_API_KEY",
      "BLOB_READ_WRITE_TOKEN",
    ] as const) {
      const context = setup({ env: { [missing]: undefined } });
      expect(await post(context)).toEqual({
        status: 503,
        body: { status: 503, error: "unavailable" },
      });
      expect(context.opened).toHaveLength(0);
      expect(context.speech.calls).toHaveLength(0);
    }
  });

  it("answers 400 for a body that is not the expected shape, or a bad digest id", async () => {
    const context = setup();
    for (const bad of ["", "not json", "{}", body({ passphrase: "" }), body({ digest: "../x" })]) {
      expect((await post(context, bad)).status).toBe(400);
    }
    expect(context.opened).toHaveLength(0);
  });

  it("answers 400 for a request from another origin before checking the passphrase", async () => {
    const verify = vi.fn(async () => true);
    const context = setup({ overrides: { verifyPassphrase: verify } });
    const result = await handleNarrate(input(body(), "https://evil.example"), context.deps);
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 401 with a constant extra delay for a wrong passphrase", async () => {
    const context = setup();
    const result = await post(context, body({ passphrase: "not the passphrase" }));
    expect(result).toEqual({ status: 401, body: { status: 401, error: "wrong_passphrase" } });
    expect(context.delays).toEqual([WRONG_PASSPHRASE_DELAY_MS]);
    expect(context.opened).toHaveLength(0);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("never echoes the submitted passphrase", async () => {
    const context = setup();
    const result = await post(context, body({ passphrase: "my private guess" }));
    expect(JSON.stringify(result) + context.logs.join("\n")).not.toContain("my private guess");
  });
});

describe("POST /api/narrate: refusals that spend nothing", () => {
  it("answers 404 when this deployment has no such digest", async () => {
    const context = setup();
    const result = await post(context, body({ digest: "2026-10-09" }));
    expect(result).toEqual({ status: 404, body: { status: 404, error: "digest_not_found" } });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("returns the audio that already exists instead of narrating again", async () => {
    const context = setup();
    const timeline = seedNarration(context);
    const result = await post(context);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      audio: { url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`, duration_ms: timeline.duration_ms },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("does not narrate over a digest the audio workflow already narrated", async () => {
    const context = setup();
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    context.digests.timelines.set(ID, makeTimeline(context.digest));
    expect((await post(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("answers 409 while another request is narrating the digest", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - 5000);
    const left = Math.ceil((MARKER_TTL_MS - 5000) / 1000);
    expect(await post(context)).toEqual({
      status: 409,
      headers: { "Retry-After": String(left) },
      body: { status: 409, error: "in_progress", retry_after_s: left },
    });
    expect(context.speech.calls).toHaveLength(0);
    // The marker belongs to the other request and must survive this one.
    expect(context.blob.has(markerKey(ID))).toBe(true);
  });

  it("ignores a marker left by a function that was stopped, once it has expired", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - MARKER_TTL_MS - 1);
    expect((await post(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(1);
    expect(context.blob.has(markerKey(ID))).toBe(false);
  });

  it("answers 429 when the month's character budget would be passed", async () => {
    const context = setup();
    // 90 percent of the default 500,000 is 450,000.
    context.blob.seed(usageKey(MONTH), usage(449_990));
    const result = await post(context);
    expect(result).toEqual({ status: 429, body: { status: 429, error: "monthly_budget" } });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
    expect(context.logs.join("\n")).toContain("449990 characters used");
  });

  it("applies SPEECHIFY_MONTHLY_CHARS and the 90 percent rule", async () => {
    const spoken = buildSpokenText(makeDigest({ id: ID })).text.length;
    // The request fits under the allowance but not under 90 percent of it.
    const refused = setup({ env: { SPEECHIFY_MONTHLY_CHARS: String(spoken + 1) } });
    expect((await post(refused)).status).toBe(429);
    const allowed = setup({ env: { SPEECHIFY_MONTHLY_CHARS: String(spoken * 2) } });
    expect((await post(allowed)).status).toBe(200);
  });

  it("counts each month in its own file, so last month's total does not carry over", async () => {
    const context = setup();
    context.blob.seed(usageKey("2026-09"), usage(449_990).replace(MONTH, "2026-09"));
    expect((await post(context)).status).toBe(200);
  });

  it("answers 503 rather than treat an unreadable counter as zero", async () => {
    const context = setup();
    context.blob.seed(usageKey(MONTH), "{ not json");
    expect((await post(context)).status).toBe(503);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("answers 429 at the daily cap, counted in digests that took a slot in the last day", async () => {
    const context = setup();
    expect(NARRATE_DAILY_CAP).toBe(3);
    seedSlot(context, "2026-10-01", NOW - 1 * HOUR);
    seedSlot(context, "2026-10-02", NOW - 5 * HOUR);
    seedSlot(context, "2026-10-03", NOW - 20 * HOUR);
    expect(await post(context)).toEqual({
      status: 429,
      headers: { "Retry-After": String(4 * 3600) },
      body: { status: 429, error: "daily_cap", retry_after_s: 4 * 3600 },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("does not count slots older than a day, or audio that took no slot", async () => {
    const context = setup();
    seedSlot(context, "2026-10-01", NOW - 1 * HOUR);
    seedSlot(context, "2026-10-02", NOW - 5 * HOUR);
    seedSlot(context, "2026-10-03", NOW - 25 * HOUR);
    // Narrations uploaded by the audio workflow are not the Play button's and hold no slot.
    context.blob.seed(audioKey("2026-10-04"), FAKE_AUDIO, NOW - 1 * HOUR);
    context.blob.seed(audioKey("2026-10-05"), FAKE_AUDIO, NOW - 1 * HOUR);
    expect((await post(context)).status).toBe(200);
  });

  it("does not refuse a digest that already holds its slot, however full the day is", async () => {
    const context = setup();
    seedSlot(context, "2026-10-01", NOW - 1 * HOUR);
    seedSlot(context, "2026-10-02", NOW - 2 * HOUR);
    seedSlot(context, "2026-10-03", NOW - 3 * HOUR);
    seedSlot(context, ID, NOW - 4 * HOUR);
    expect((await post(context)).status).toBe(200);
    // It keeps the slot it had: the time it was taken does not move.
    expect(context.blob.changes()).not.toContain(`put ${slotKey(ID)}`);
  });

  it("answers 422 for a digest too long to read in one request", async () => {
    const long = makeDigest({
      id: ID,
      items: [1, 2, 3, 4].map((seed) => makeItem(seed, "top", { summary: "word ".repeat(1200) })),
    });
    const context = setup({ digests: [long] });
    expect(await post(context)).toEqual({
      status: 422,
      body: { status: 422, error: "not_narratable" },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("answers 503 when the store cannot be reached, before anything is spent", async () => {
    const context = setup();
    context.blob.failNext("list", 1, { error: new Error(`${UPSTREAM} ${BLOB_TOKEN}`) });
    const result = await post(context);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(context.speech.calls).toHaveLength(0);
    expectNothingLeaked(result, context.logs);
  });
});

describe("POST /api/narrate: narrating", () => {
  it("narrates, stores the MP3, then the timeline, then the usage, and returns the GET body", async () => {
    const context = setup();
    const spoken = buildSpokenText(context.digest);
    const result = await post(context);

    expect(context.blob.changes()).toEqual([
      // The digest's place under the daily cap, then the marker, then the paid work in order.
      `put ${slotKey(ID)}`,
      `put ${markerKey(ID)}`,
      `put ${audioKey(ID)}`,
      `put ${timelineKey(ID)}`,
      `put ${usageKey(MONTH)}`,
      `del ${markerKey(ID)}`,
    ]);

    const durationMs = wordMarks(spoken.text).length * MS_PER_WORD;
    expect(result.status).toBe(200);
    expect(result.headers).toBeUndefined();
    const narrated = wholeBody(result);
    // Exactly the whole-digest body: no segment list and nothing else rides along.
    expect(Object.keys(narrated).sort()).toEqual(["audio", "status", "timeline"]);
    expect(narrated.audio).toEqual({
      url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`,
      duration_ms: durationMs,
    });
    expect(narrated.timeline.kind).toBe("marks");
    expect(narrated.timeline.items.map((item) => item.id)).toEqual(
      spoken.ranges.map((range) => range.id),
    );
    const starts = narrated.timeline.items.map((item) => item.start_ms);
    expect(starts[0]).toBeGreaterThan(0);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(narrated.timeline.items.at(-1)?.end_ms).toBe(durationMs);

    // What is stored is what a later GET returns.
    expect(context.blob.bytes(audioKey(ID))).toEqual(FAKE_AUDIO);
    expect(context.blob.written(audioKey(ID))).toEqual({
      contentType: "audio/mpeg",
      cacheSeconds: 3600,
    });
    expect(context.blob.written(timelineKey(ID))?.contentType).toBe("application/json");
    const stored = AudioTimeline.parse(JSON.parse(context.blob.text(timelineKey(ID)) ?? ""));
    expect(stored.digest).toBe(ID);
    expect(stored.text_chars).toBe(spoken.text.length);
    const found = lookupBody(await lookup(context));
    expect(found.audio).toEqual(narrated.audio);
    expect(found.timeline).toEqual(narrated.timeline);
    // Narrating the whole digest makes no segment files.
    expect(found.segments.every((segment) => segment.audio === null)).toBe(true);

    expect(JSON.parse(context.blob.text(usageKey(MONTH)) ?? "")).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: spoken.text.length },
    });
    expect(context.blob.has(markerKey(ID))).toBe(false);
  });

  it("sends Speechify the spoken text with the key, the configured voice and the deadline", async () => {
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "henry_7" } });
    await post(context);
    expect(context.speech.calls).toHaveLength(1);
    const call = context.speech.calls[0];
    expect(call?.url).toBe("https://api.speechify.ai/v1/audio/stream/with-timestamps");
    expect(call?.authorization).toBe(`Bearer ${SPEECHIFY_KEY}`);
    expect(call?.body.input).toBe(buildSpokenText(context.digest).text);
    expect(call?.body.voice_id).toBe("henry_7");
    expect(context.deadlines).toEqual([SYNTHESIS_DEADLINE_MS]);
    expect(context.state.cancelled).toBe(1);
  });

  it("uses fixed inputs whatever the caller sends", async () => {
    const context = setup();
    await post(context, body({ text: "say this instead", voice_id: "other", model: "big" }));
    const call = context.speech.calls[0];
    expect(call?.body.input).toBe(buildSpokenText(context.digest).text);
    expect(call?.body.voice_id).toBe("geffen_32");
    expect(call?.body.model).toBe("simba-3.2");
  });

  it("adds to the month's count instead of replacing it", async () => {
    const context = setup();
    context.blob.seed(usageKey(MONTH), usage(1000));
    await post(context);
    const spoken = buildSpokenText(context.digest).text.length;
    expect(JSON.parse(context.blob.text(usageKey(MONTH)) ?? "").speechify.characters).toBe(
      1000 + spoken,
    );
  });

  it("falls back to the plain stream and an estimated timeline when marks are unavailable", async () => {
    const context = setup({ speech: { kind: "no_marks" } });
    const result = await post(context);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      audio: { duration_ms: 4000 },
      timeline: { kind: "estimated" },
    });
    expect(context.blob.bytes(audioKey(ID))).toEqual(FAKE_PLAIN_AUDIO);
    expect(context.speech.calls.map((call) => call.url)).toEqual([
      "https://api.speechify.ai/v1/audio/stream/with-timestamps",
      "https://api.speechify.ai/v1/audio/stream",
    ]);
  });

  it("logs the timings the function limits have to be set from", async () => {
    const context = setup();
    // Speechify takes 40 seconds in this run; everything else is instant.
    const fetchSpeech = context.deps.fetch;
    context.deps.fetch = async (url, init) => {
      const response = await fetchSpeech(url, init);
      context.advance(40_000);
      return response;
    };
    await post(context);
    expect(context.logs.at(-1)).toMatch(
      /stored\. \d+ characters, synthesis 40000 ms, upload 0 ms, total 40000 ms, marks timeline$/,
    );
  });
});

describe("POST /api/narrate: when synthesis fails", () => {
  it("answers 502, clears the marker, records no usage and hides the upstream body", async () => {
    const context = setup({
      speech: {
        kind: "http_error",
        status: 500,
        body: { error: { code: "internal", message: `${UPSTREAM} for key ${SPEECHIFY_KEY}` } },
      },
    });
    const result = await post(context);
    expect(result).toEqual({ status: 502, body: { status: 502, error: "synthesis_failed" } });
    expect(context.blob.changes()).toEqual([
      `put ${slotKey(ID)}`,
      `put ${markerKey(ID)}`,
      `del ${markerKey(ID)}`,
    ]);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
    expect(context.logs.join("\n")).toContain("HTTP 500");
    expectNothingLeaked(result, context.logs);
  });

  it("answers 502 when the request cannot be sent, with the key redacted from the log", async () => {
    const context = setup({
      speech: { kind: "throw", error: new Error(`socket closed while sending ${SPEECHIFY_KEY}`) },
    });
    const result = await post(context);
    expect(result.status).toBe(502);
    expect(context.logs.join("\n")).toContain("[redacted]");
    expectNothingLeaked(result, context.logs);
  });

  it("stops the upstream request at the deadline and answers 504", async () => {
    const context: Setup = setup({
      speech: {
        kind: "stall",
        markedWords: 5,
        onStall: () => context.deadline.abort(timeoutReason()),
      },
    });
    const result = await post(context);
    expect(result).toEqual({ status: 504, body: { status: 504, error: "took_too_long" } });
    // The request Speechify holds open was told to stop, not left running.
    expect(context.speech.calls[0]?.signal?.aborted).toBe(true);
    expect(context.blob.changes()).toEqual([
      `put ${slotKey(ID)}`,
      `put ${markerKey(ID)}`,
      `del ${markerKey(ID)}`,
    ]);
    expect(context.blob.has(audioKey(ID))).toBe(false);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
    expect(context.state.cancelled).toBe(1);

    // The stream had already synthesized five words. That spend is not counted, so it is logged.
    const spoken = buildSpokenText(context.digest).text;
    const spent = wordMarks(spoken)[4]?.end;
    expect(context.logs.join("\n")).toContain(`at least ${spent} characters were synthesized`);
    expect(context.logs.join("\n")).toContain(`${SYNTHESIS_DEADLINE_MS} ms deadline`);
  });

  it("answers 504 when Speechify has not even started answering by the deadline", async () => {
    const context: Setup = setup({
      speech: { kind: "hang", onHang: () => context.deadline.abort(timeoutReason()) },
    });
    expect((await post(context)).status).toBe(504);
    expect(context.blob.has(markerKey(ID))).toBe(false);
  });

  it("stops waiting out a rate limit when the deadline passes", async () => {
    const context: Setup = setup({
      speech: {
        kind: "http_error",
        status: 429,
        body: { error: { code: "rate_limited" } },
        headers: { "Retry-After": "2" },
      },
      overrides: {
        // The only wait in this flow is the client's pause before its retry.
        delay: () => {
          context.deadline.abort(timeoutReason());
          return new Promise<void>(() => {});
        },
      },
    });
    expect((await post(context)).status).toBe(504);
    expect(context.speech.calls).toHaveLength(1);
  });
});

describe("POST /api/narrate: when the upload fails", () => {
  it("retries the MP3 upload inside the function and succeeds", async () => {
    const context = setup();
    context.blob.failNext("put", 2, { prefix: "audio/" });
    const result = await post(context);
    expect(result.status).toBe(200);
    expect(context.delays).toEqual([UPLOAD_RETRY_DELAY_MS, UPLOAD_RETRY_DELAY_MS * 2]);
    expect(context.blob.calls.filter((call) => call.pathname === audioKey(ID))).toHaveLength(
      // One lookup before narrating, then every attempt.
      1 + UPLOAD_ATTEMPTS,
    );
    // Paid for once: the retries re-send the same audio.
    expect(context.speech.calls).toHaveLength(1);
    expect(context.blob.has(usageKey(MONTH))).toBe(true);
  });

  it("retries the timeline upload too", async () => {
    const context = setup();
    context.blob.failNext("put", 1, { prefix: "timeline/" });
    expect((await post(context)).status).toBe(200);
    expect(context.delays).toEqual([UPLOAD_RETRY_DELAY_MS]);
  });

  it("gives up after the last attempt: 502, usage not recorded, marker cleared", async () => {
    const context = setup();
    context.blob.failNext("put", UPLOAD_ATTEMPTS, {
      prefix: "audio/",
      error: new Error(`${UPSTREAM}: store rejected ${BLOB_TOKEN}`),
    });
    const result = await post(context);
    expect(result).toEqual({ status: 502, body: { status: 502, error: "storage_failed" } });
    expect(context.blob.has(audioKey(ID))).toBe(false);
    expect(context.blob.has(timelineKey(ID))).toBe(false);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
    expect(context.blob.has(markerKey(ID))).toBe(false);
    expect(context.blob.changes().at(-1)).toBe(`del ${markerKey(ID)}`);
    expect(context.logs.join("\n")).toContain("not counted");
    expectNothingLeaked(result, context.logs);
  });

  it("does not record usage when the timeline cannot be stored either", async () => {
    const context = setup();
    context.blob.failNext("put", UPLOAD_ATTEMPTS, { prefix: "timeline/" });
    const result = await post(context);
    expect(result.status).toBe(502);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
    // The MP3 alone is not a narration: a later request finds nothing and starts again.
    expect(lookupBody(await lookup(context)).audio).toBeNull();
  });

  it("treats an upload URL that is not https as a failed upload", async () => {
    const context = setup();
    const put = context.blob.put.bind(context.blob);
    context.blob.put = async (pathname, bytes, options) => {
      const stored = await put(pathname, bytes, options);
      return pathname.startsWith("audio/")
        ? { url: `http://insecure.example/${pathname}` }
        : stored;
    };
    expect(await post(context)).toEqual({
      status: 502,
      body: { status: 502, error: "storage_failed" },
    });
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
  });

  it("still returns the audio when only the usage counter cannot be written", async () => {
    const context = setup();
    context.blob.failNext("put", 1, { prefix: "state/usage-" });
    const result = await post(context);
    expect(result.status).toBe(200);
    expect(context.logs.join("\n")).toContain("could not be added to the counter");
    expect(context.blob.has(markerKey(ID))).toBe(false);
  });

  it("returns the audio even when the marker cannot be cleared", async () => {
    const context = setup();
    context.blob.failNext("del", 1);
    expect((await post(context)).status).toBe(200);
    expect(context.logs.join("\n")).toContain("will expire");
  });
});

describe("POST /api/narrate: nothing leaks", () => {
  it("keeps keys, tokens and upstream bodies out of every error answer", async () => {
    const leaky = new Error(`${UPSTREAM} ${SPEECHIFY_KEY} ${BLOB_TOKEN} ${passphraseHash}`);
    const scenarios: Array<{
      status: number;
      arrange: (context: Setup) => void;
      speech?: FakeSpeechMode;
    }> = [
      { status: 503, arrange: (context) => context.blob.failNext("head", 1, { error: leaky }) },
      { status: 503, arrange: (context) => context.blob.failNext("read", 1, { error: leaky }) },
      { status: 503, arrange: (context) => context.blob.failNext("list", 1, { error: leaky }) },
      {
        status: 503,
        arrange: (context) =>
          context.blob.failNext("put", 1, { prefix: "state/narrating-", error: leaky }),
      },
      { status: 502, arrange: () => {}, speech: { kind: "throw", error: leaky } },
      {
        status: 502,
        arrange: (context) =>
          context.blob.failNext("put", UPLOAD_ATTEMPTS, { prefix: "audio/", error: leaky }),
      },
      {
        status: 200,
        arrange: (context) =>
          context.blob.failNext("put", 1, { prefix: "state/usage-", error: leaky }),
      },
      { status: 200, arrange: (context) => context.blob.failNext("del", 1, { error: leaky }) },
    ];
    for (const scenario of scenarios) {
      const context = setup(scenario.speech ? { speech: scenario.speech } : {});
      scenario.arrange(context);
      const result = await post(context);
      expect(result.status).toBe(scenario.status);
      expect(context.logs.join("\n")).toContain("[redacted]");
      expectNothingLeaked(result, context.logs);
    }
  });
});

describe("POST /api/narrate with a segment", () => {
  const postSegment = (context: Setup, segment: unknown, fields: Record<string, unknown> = {}) =>
    post(context, body({ segment, ...fields }));
  const segmentFiles = (context: Setup) =>
    context.blob.changes().filter((change) => change.startsWith(`put audio/${ID}/seg/`));

  it("narrates that one segment, names its file after what it holds, and returns it", async () => {
    const context = setup();
    const intro = segmentOf(context.digest, "intro");
    // The duration is the one the stream's done event reports.
    const durationMs = wordMarks(intro.text).length * MS_PER_WORD;
    const path = segmentPath(ID, "intro", segmentHash(intro.text, VOICE, MODEL), durationMs);

    const result = await postSegment(context, "intro");
    expect(result).toEqual({
      status: 200,
      body: {
        status: 200,
        segment: {
          key: "intro",
          item_id: null,
          characters: intro.text.length,
          audio: { url: `${FAKE_BLOB_HOST}/${path}`, duration_ms: durationMs },
        },
      },
    });

    // Speechify read the intro and nothing else.
    expect(context.speech.calls).toHaveLength(1);
    expect(context.speech.calls[0]?.body.input).toBe(intro.text);

    // The digest's slot, the file, then the count. No marker and no whole-digest files.
    expect(context.blob.changes()).toEqual([
      `put ${slotKey(ID)}`,
      `put ${path}`,
      `put ${usageKey(MONTH)}`,
    ]);
    expect(context.blob.bytes(path)).toEqual(FAKE_AUDIO);
    expect(context.blob.written(path)).toEqual({
      contentType: "audio/mpeg",
      cacheSeconds: 30 * 24 * 3600,
    });
    expect(context.blob.has(audioKey(ID))).toBe(false);
    expect(context.blob.has(timelineKey(ID))).toBe(false);

    // The budget is charged for the segment's characters only.
    expect(JSON.parse(context.blob.text(usageKey(MONTH)) ?? "").speechify.characters).toBe(
      intro.text.length,
    );
    // And the next lookup finds it by its name alone.
    expect(lookupBody(await lookup(context)).segments[0]?.audio).toEqual(segmentBody(result).audio);
  });

  it("narrates a story with the section's lead-in when it opens the section", async () => {
    const context = setup();
    const key = storyKey(context.digest, 0);
    const story = segmentOf(context.digest, key);
    const narrated = segmentBody(await postSegment(context, key));
    expect(narrated.item_id).toBe(key);
    expect(narrated.characters).toBe(story.text.length);
    expect(context.speech.calls[0]?.body.input).toBe(story.text);
    // More than the story's own text: the announcement of its section comes first.
    const own = buildSpokenText(context.digest).ranges.find((range) => range.id === key);
    expect(story.text.length).toBeGreaterThan((own?.end ?? 0) - (own?.start ?? 0));
  });

  it("refuses an unknown segment before any store or speech call", async () => {
    const context = setup();
    for (const segment of ["outro", "ffffffffffff", "nope"]) {
      expect(await postSegment(context, segment)).toEqual({
        status: 404,
        body: { status: 404, error: "segment_not_found" },
      });
    }
    expect(context.blob.calls).toEqual([]);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("refuses a malformed segment key with 400 and never narrates the whole digest instead", async () => {
    const context = setup();
    for (const segment of [null, "", 7, "../intro", "Intro"]) {
      expect((await postSegment(context, segment)).status).toBe(400);
    }
    expect(context.blob.calls).toEqual([]);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("refuses a segment of a digest this deployment does not have, before any store call", async () => {
    const context = setup();
    expect(await postSegment(context, "intro", { digest: "2026-10-09" })).toEqual({
      status: 404,
      body: { status: 404, error: "digest_not_found" },
    });
    expect(context.blob.calls).toEqual([]);
  });

  it("asks for the same passphrase and the same origin as the whole digest", async () => {
    const context = setup();
    expect((await postSegment(context, "intro", { passphrase: "not it" })).status).toBe(401);
    const crossOrigin = input(body({ segment: "intro" }), "https://evil.example");
    expect((await handleNarrate(crossOrigin, context.deps)).status).toBe(400);
    expect(context.blob.calls).toEqual([]);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("returns a segment that is already narrated as it is, and spends nothing", async () => {
    const context = setup();
    const seeded = seedSegment(context, "intro", { durationMs: 2750 });
    const result = await postSegment(context, "intro");
    expect(segmentBody(result)).toEqual({
      key: "intro",
      item_id: null,
      characters: seeded.segment.text.length,
      audio: seeded.audio,
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("narrates an edited story again under a new name, and never an unchanged one", async () => {
    const context = setup();
    const key = storyKey(context.digest, 0);
    const before = seedSegment(context, key, { text: "The story as it read before the edit." });

    const narrated = segmentBody(await postSegment(context, key));
    expect(context.speech.calls).toHaveLength(1);
    expect(narrated.audio.url).not.toBe(before.audio.url);
    // The old file stays: a page that is still open may be playing it.
    expect(context.blob.has(before.path)).toBe(true);
    const listed = lookupBody(await lookup(context)).segments.find(
      (segment) => segment.key === key,
    );
    expect(listed?.audio).toEqual(narrated.audio);

    // The text has not changed since, so asking again finds the new file and spends nothing.
    expect(segmentBody(await postSegment(context, key)).audio).toEqual(narrated.audio);
    expect(context.speech.calls).toHaveLength(1);
  });

  it("checks the budget against the segment's characters, not the digest's", async () => {
    const intro = segmentOf(makeDigest({ id: ID }), "intro").text.length;
    // 90 percent of the default 500,000 is 450,000: room for the intro, not for the digest.
    const roomForIntro = 450_000 - intro;

    const fits = setup();
    fits.blob.seed(usageKey(MONTH), usage(roomForIntro));
    expect((await postSegment(fits, "intro")).status).toBe(200);
    expect(JSON.parse(fits.blob.text(usageKey(MONTH)) ?? "").speechify.characters).toBe(450_000);

    const whole = setup();
    whole.blob.seed(usageKey(MONTH), usage(roomForIntro));
    expect((await post(whole)).status).toBe(429);

    const oneShort = setup();
    oneShort.blob.seed(usageKey(MONTH), usage(roomForIntro + 1));
    expect(await postSegment(oneShort, "intro")).toEqual({
      status: 429,
      body: { status: 429, error: "monthly_budget" },
    });
    expect(oneShort.speech.calls).toHaveLength(0);
    expect(oneShort.blob.changes()).toEqual([]);
  });

  it("takes the day's slot with a digest's first segment and not with its later ones", async () => {
    const context = setup();
    const keys = spokenSegments(context.digest).map((segment) => segment.key);
    for (const key of keys) expect((await postSegment(context, key)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(keys.length);
    expect(segmentFiles(context)).toHaveLength(keys.length);
    // Five segments, one digest, one slot.
    expect(context.blob.changes().filter((change) => change === `put ${slotKey(ID)}`)).toHaveLength(
      1,
    );
    expect(await context.blob.list("state/slots/")).toHaveLength(1);
  });

  it("counts digests, not segments, toward the daily cap", async () => {
    // Three other digests took today's slots, so a fourth digest's first segment is refused.
    const fourth = setup();
    seedSlot(fourth, "2026-10-01", NOW - 1 * HOUR);
    seedSlot(fourth, "2026-10-02", NOW - 5 * HOUR);
    seedSlot(fourth, "2026-10-03", NOW - 20 * HOUR);
    expect(await postSegment(fourth, "intro")).toEqual({
      status: 429,
      headers: { "Retry-After": String(4 * 3600) },
      body: { status: 429, error: "daily_cap", retry_after_s: 4 * 3600 },
    });
    expect(fourth.speech.calls).toHaveLength(0);
    expect(fourth.blob.changes()).toEqual([]);

    // A digest that holds one of the three slots goes on, segment after segment.
    const holder = setup();
    seedSlot(holder, "2026-10-01", NOW - 1 * HOUR);
    seedSlot(holder, "2026-10-02", NOW - 5 * HOUR);
    seedSlot(holder, ID, NOW - 2 * HOUR);
    for (const segment of spokenSegments(holder.digest)) {
      expect((await postSegment(holder, segment.key)).status).toBe(200);
    }
    expect(holder.blob.changes()).not.toContain(`put ${slotKey(ID)}`);
  });

  it("keeps both files when two segments of one digest are narrated at the same time", async () => {
    const context = setup();
    const first = storyKey(context.digest, 0);
    const second = storyKey(context.digest, 1);
    const [a, b] = await Promise.all([postSegment(context, first), postSegment(context, second)]);

    // Neither request could undo the other: there is no shared record to overwrite.
    const { segments } = lookupBody(await lookup(context));
    expect(segments.find((segment) => segment.key === first)?.audio).toEqual(segmentBody(a).audio);
    expect(segments.find((segment) => segment.key === second)?.audio).toEqual(segmentBody(b).audio);
    expect(segmentFiles(context)).toHaveLength(2);
    // Both wrote the digest's slot, and it is still one slot.
    expect(await context.blob.list("state/slots/")).toHaveLength(1);
  });

  it("answers 502 when synthesis fails: no file, no usage, and nothing to clean up", async () => {
    const context = setup({
      speech: {
        kind: "http_error",
        status: 500,
        body: { error: { code: "internal", message: `${UPSTREAM} for key ${SPEECHIFY_KEY}` } },
      },
    });
    const result = await postSegment(context, "intro");
    expect(result).toEqual({ status: 502, body: { status: 502, error: "synthesis_failed" } });
    expect(context.blob.changes()).toEqual([`put ${slotKey(ID)}`]);
    expect(context.logs.join("\n")).toContain(`narrate ${ID} intro: synthesis failed`);
    expectNothingLeaked(result, context.logs);
  });

  it("stops the upstream request at the deadline and answers 504", async () => {
    const context: Setup = setup({
      speech: {
        kind: "stall",
        markedWords: 2,
        onStall: () => context.deadline.abort(timeoutReason()),
      },
    });
    const result = await postSegment(context, storyKey(context.digest, 0));
    expect(result).toEqual({ status: 504, body: { status: 504, error: "took_too_long" } });
    expect(context.speech.calls[0]?.signal?.aborted).toBe(true);
    expect(context.deadlines).toEqual([SYNTHESIS_DEADLINE_MS]);
    expect(segmentFiles(context)).toEqual([]);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
  });

  it("retries the upload inside the function, and gives up without recording usage", async () => {
    const retried = setup();
    retried.blob.failNext("put", 2, { prefix: `audio/${ID}/seg/` });
    expect((await postSegment(retried, "intro")).status).toBe(200);
    expect(retried.delays).toEqual([UPLOAD_RETRY_DELAY_MS, UPLOAD_RETRY_DELAY_MS * 2]);
    expect(retried.speech.calls).toHaveLength(1);

    const failed = setup();
    failed.blob.failNext("put", UPLOAD_ATTEMPTS, {
      prefix: `audio/${ID}/seg/`,
      error: new Error(`${UPSTREAM}: store rejected ${BLOB_TOKEN}`),
    });
    const result = await postSegment(failed, "intro");
    expect(result).toEqual({ status: 502, body: { status: 502, error: "storage_failed" } });
    expect(failed.blob.has(usageKey(MONTH))).toBe(false);
    expect(lookupBody(await lookup(failed)).segments[0]?.audio).toBeNull();
    expectNothingLeaked(result, failed.logs);
  });

  it("takes the duration from the audio's size when the marks endpoint is unavailable", async () => {
    const context = setup({ speech: { kind: "no_marks" } });
    const narrated = segmentBody(await postSegment(context, "intro"));
    expect(narrated.audio.duration_ms).toBe(4000);
    expect(narrated.audio.url).toMatch(/\.4000\.mp3$/);
  });

  it("answers 503 when the store cannot be reached, with nothing spent and nothing leaked", async () => {
    const leaky = new Error(`${UPSTREAM} ${SPEECHIFY_KEY} ${BLOB_TOKEN} ${passphraseHash}`);
    for (const op of ["list", "read"] as const) {
      const context = setup();
      context.blob.failNext(op, 1, { error: leaky });
      const result = await postSegment(context, "intro");
      expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
      expect(context.speech.calls).toHaveLength(0);
      expect(context.logs.join("\n")).toContain("[redacted]");
      expectNothingLeaked(result, context.logs);
    }
  });

  it("still returns the segment when its slot or its count cannot be written", async () => {
    const slotless = setup();
    slotless.blob.failNext("put", 1, { prefix: "state/slots/" });
    expect((await postSegment(slotless, "intro")).status).toBe(200);
    expect(slotless.logs.join("\n")).toContain("the daily slot could not be written");

    const uncounted = setup();
    uncounted.blob.failNext("put", 1, { prefix: "state/usage-" });
    expect((await postSegment(uncounted, "intro")).status).toBe(200);
    expect(uncounted.logs.join("\n")).toContain("could not be added to the counter");
  });

  it("logs the timings a segment took", async () => {
    const context = setup();
    await postSegment(context, "intro");
    expect(context.logs.at(-1)).toMatch(
      /^narrate 2026-10-07 intro: stored\. \d+ characters, synthesis \d+ ms, upload \d+ ms, total \d+ ms$/,
    );
  });
});

describe("POST /api/narrate: the whole digest beside segments", () => {
  it("is unchanged when segments exist: one file for the whole text, and the segments stay", async () => {
    const context = setup();
    const intro = seedSegment(context, "intro");
    const narrated = wholeBody(await post(context));

    expect(context.speech.calls).toHaveLength(1);
    expect(context.speech.calls[0]?.body.input).toBe(buildSpokenText(context.digest).text);
    expect(narrated.audio.url).toBe(`${FAKE_BLOB_HOST}/audio/${ID}.mp3`);
    expect(narrated.timeline.items).toHaveLength(context.digest.items.length);

    const found = lookupBody(await lookup(context));
    expect(found.audio).toEqual(narrated.audio);
    expect(found.segments[0]?.audio).toEqual(intro.audio);
  });

  it("does not hold up a segment while the whole digest is being narrated", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - 5000);
    expect((await post(context)).status).toBe(409);
    expect((await post(context, body({ segment: "intro" }))).status).toBe(200);
    // The whole-digest marker is not the segment's to clear.
    expect(context.blob.has(markerKey(ID))).toBe(true);
  });

  it("holds one slot for a digest narrated both ways", async () => {
    const context = setup();
    expect((await post(context, body({ segment: "intro" }))).status).toBe(200);
    expect((await post(context)).status).toBe(200);
    expect(context.blob.changes().filter((change) => change === `put ${slotKey(ID)}`)).toHaveLength(
      1,
    );
  });
});

describe("startDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts with a timeout once the time is up", () => {
    vi.useFakeTimers();
    const deadline = startDeadline(1000);
    vi.advanceTimersByTime(999);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    expect((deadline.signal.reason as Error).name).toBe("TimeoutError");
  });

  it("never fires once it is cancelled", () => {
    vi.useFakeTimers();
    const deadline = startDeadline(1000);
    deadline.cancel();
    vi.advanceTimersByTime(5000);
    expect(deadline.signal.aborted).toBe(false);
  });
});
