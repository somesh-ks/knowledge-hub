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
import { readFresh, versionedUrl } from "./blobStore";
import { type BlobCredentials, MS_PER_CHARACTER, type ServerEnv } from "./config";
import {
  BLOB_UPLOAD_TIMEOUT_MS,
  FUNCTION_MAX_DURATION_S,
  PRE_SYNTHESIS_BOUND_MS,
  SYNTHESIS_DEADLINE_MS,
} from "./functionLimits.mjs";
import { WRONG_PASSPHRASE_DELAY_MS } from "./generate";
import type { ApiResult } from "./http";
import { NARRATE_DAILY_CAP } from "./limits";
import {
  audioKey,
  type DigestSource,
  handleNarrate,
  handleNarrationLookup,
  MARKER_CLEAR_WAIT_MS,
  MARKER_TTL_MS,
  markerKey,
  type NarrateBody,
  type NarrateDeps,
  parseDigestId,
  parseNarrateRequest,
  RESPONSE_MARGIN_MS,
  startDeadline,
  timelineKey,
  UPLOAD_ATTEMPTS,
  UPLOAD_RETRY_DELAY_MS,
} from "./narrate";
import { segmentHash, segmentPath } from "./narrateSegments";
import { usageKey } from "./narrationState";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const HOUR = 3_600_000;
const ORIGIN = "https://news.someshks.work";
const ID = "2026-10-07";
const MONTH = "2026-10";
/** The Stockholm date at NOW, and how long that day has left (it is 14:00 there). */
const TODAY = "2026-10-07";
const UNTIL_MIDNIGHT_S = 10 * 3600;
const PASSPHRASE = "correct horse battery staple";
const SPEECHIFY_KEY = "speechify-test-key-8f3a9c1e2b7d";
/** The store's name is the fourth part, and with it the public address: FAKE_BLOB_HOST. */
const BLOB_TOKEN = "vercel_blob_rw_teststore_0123456789abcdefghij";
/** Text only an upstream service would say. It must never reach a caller. */
const UPSTREAM = "UPSTREAM-DETAIL-4c1f";
/** The engine's default voice and model, which the segment file names are hashed with. */
const VOICE = "geffen_32";
const MODEL = "simba-3.2";

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
  /** Put the fake CDN in front of the store, so a URL it has seen is answered from its cache. */
  cdn?: boolean;
  overrides?: Partial<NarrateDeps>;
}

function setup(options: SetupOptions = {}) {
  let clock = NOW;
  const digest =
    options.digests?.find((candidate) => candidate.id === ID) ?? makeDigest({ id: ID });
  const blob = createFakeBlobStore(() => clock, { cdn: options.cdn ?? false });
  const speech = createFakeSpeechify(options.speech);
  const digests = fakeDigests(options.digests ?? [digest]);
  const delays: number[] = [];
  const logs: string[] = [];
  const opened: BlobCredentials[] = [];
  /** The synthesis deadline. A test aborts it to let the deadline pass. */
  const deadline = new AbortController();
  /** The wait for the marker's delete. A test aborts it to stop waiting for a delete that hangs. */
  const markerWait = new AbortController();
  /** The one clock for the store calls before synthesis. A test aborts it to let it run out. */
  const setupClock = new AbortController();
  /** The time a failed attempt has to be counted in. Never runs out in these tests. */
  const repeatClock = new AbortController();
  /** How long each synthesis was given. */
  const deadlines: number[] = [];
  /** Every clock that was started, as "purpose:milliseconds". */
  const clocks: string[] = [];
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
    // Waiting takes time: the clock moves, so time limits see every pause.
    delay: async (milliseconds) => {
      delays.push(milliseconds);
      clock += milliseconds;
    },
    verifyPassphrase,
    openBlob: (credentials) => {
      opened.push(credentials);
      return blob;
    },
    digests,
    startDeadline: (milliseconds, purpose) => {
      clocks.push(`${purpose}:${milliseconds}`);
      if (purpose === "synthesis") deadlines.push(milliseconds);
      const controller =
        purpose === "marker"
          ? markerWait
          : purpose === "setup"
            ? setupClock
            : purpose === "repeat"
              ? repeatClock
              : deadline;
      return {
        signal: controller.signal,
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
    markerWait,
    setupClock,
    deadlines,
    clocks,
    state,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    /** How long the request has been running, by the clock the handler reads. */
    elapsed: () => clock - NOW,
  };
}

type Setup = ReturnType<typeof setup>;
type Result = ApiResult<NarrateBody>;

const body = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ digest: ID, passphrase: PASSPHRASE, ...fields });
const input = (bodyText: string = body(), origin: string | null = ORIGIN) => ({
  bodyText,
  origin,
  expectedOrigin: ORIGIN,
});
const post = (context: Setup, bodyText?: string) => handleNarrate(input(bodyText), context.deps);
const postSegment = (context: Setup, segment: unknown, fields: Record<string, unknown> = {}) =>
  post(context, body({ segment, ...fields }));
const lookup = (context: Setup, digest: string | null = ID, params?: string[]) =>
  handleNarrationLookup(
    { digest, params: params ?? (digest === null ? [] : ["digest"]) },
    context.deps,
  );

/** The length of everything said of a digest. It is what the digest is charged. */
const wholeChars = (digest: Digest): number => buildSpokenText(digest).text.length;

function segmentOf(digest: Digest, key: string): SpokenSegment {
  const segment = spokenSegments(digest).find((candidate) => candidate.key === key);
  if (!segment) throw new Error(`the digest has no segment ${key}`);
  return segment;
}

/** A value the test knows is there, failing with a clear message instead of using `!`. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

/** The key of the nth story in spoken order (0 is the first story, after the intro). */
const storyKey = (digest: Digest, index: number): string =>
  spokenSegments(digest).filter((segment) => segment.itemId !== null)[index]?.key ?? "";

const pathOf = (digest: Digest, key: string, voice = VOICE): string =>
  segmentPath(digest.id, key, segmentHash(segmentOf(digest, key).text, voice, MODEL));

/** How long the engine says an MP3 of this size plays, at 128 kbps. */
const durationOf = (bytes: number): number => Math.round((bytes * 8) / 128);

interface SeedSegmentOptions {
  /** The size of the stored file. 16,000 bytes is one second. */
  bytes?: number;
  /** Text the file was made from, when it is not the segment's current text. */
  text?: string;
  voice?: string;
}

/** Puts a narrated segment in the store, named as a successful POST would have named it. */
function seedSegment(context: Setup, key: string, options: SeedSegmentOptions = {}) {
  const segment = segmentOf(context.digest, key);
  const bytes = options.bytes ?? 24_000;
  const hash = segmentHash(options.text ?? segment.text, options.voice ?? VOICE, MODEL);
  const path = segmentPath(ID, key, hash);
  context.blob.seed(path, new Uint8Array(bytes), NOW - HOUR);
  return {
    path,
    segment,
    audio: { url: `${FAKE_BLOB_HOST}/${path}`, duration_ms: durationOf(bytes) },
  };
}

/** Puts a finished whole-digest narration in the store, as a successful POST would have left it. */
function seedNarration(context: Setup, uploadedAt = NOW - HOUR) {
  const timeline = makeTimeline(context.digest);
  context.blob.seed(audioKey(ID), FAKE_AUDIO, uploadedAt);
  context.blob.seed(timelineKey(ID), JSON.stringify(timeline), uploadedAt);
  return timeline;
}

type Charges = Record<
  string,
  {
    day: string;
    characters: number;
    voice?: string;
    whole?: boolean;
    segments?: boolean;
    repeats?: number;
  }
>;

/** What a digest's entry records beside its day and characters, by the way it was narrated. */
const IN_SEGMENTS = { voice: VOICE, whole: false, segments: true };
const AS_WHOLE = { voice: VOICE, whole: true, segments: false };
const NO_OPERATIONS = { advanced: 0, simple: 0, free: 0 };

/** The month's document as the function stores it. */
const stateDoc = (characters: number, digests: Charges = {}) =>
  JSON.stringify({ version: 1, speechify: { month: MONTH, characters }, digests });
const seedState = (context: Setup, characters: number, digests: Charges = {}) =>
  context.blob.seed(usageKey(MONTH), stateDoc(characters, digests));
const stateOf = (context: Setup) => JSON.parse(context.blob.text(usageKey(MONTH)) ?? "null");

/** Three other digests first narrated today: the day is full. */
const fullDay: Charges = {
  "2026-10-01": { day: TODAY, characters: 300 },
  "2026-10-02": { day: TODAY, characters: 300 },
  "2026-10-03": { day: TODAY, characters: 300 },
};

const timeoutReason = () => new DOMException("deadline", "TimeoutError");

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
    for (const segment of [null, "", 7, true, ["intro"], "../intro", "Intro", "a.b"]) {
      expect(parseNarrateRequest(body({ segment }))).toBeNull();
    }
    expect(parseNarrateRequest(body({ segment: "x".repeat(33) }))).toBeNull();
  });
});

describe("GET /api/narrate", () => {
  /** Asserts the lookup asked the store nothing: not opened, not called, nothing billed. */
  function expectNoStoreUse(context: Setup) {
    expect(context.opened).toHaveLength(0);
    expect(context.blob.calls).toEqual([]);
    expect(context.blob.operations()).toEqual(NO_OPERATIONS);
  }

  it("answers 400 for a missing or malformed digest id", async () => {
    const context = setup();
    for (const bad of [null, "", "latest", "../x"]) {
      expect(await lookup(context, bad)).toEqual({
        status: 400,
        body: { status: 400, error: "invalid_request" },
      });
    }
    expectNoStoreUse(context);
  });

  it("answers 400 for any query parameter but one `digest`, before anything else", async () => {
    const context = setup();
    const readDigest = vi.spyOn(context.digests, "readDigest");
    for (const params of [
      ["digest", "cachebuster"],
      ["cachebuster", "digest"],
      ["digest", "digest"],
      ["x"],
    ]) {
      const result = await lookup(context, ID, params);
      expect(result).toEqual({ status: 400, body: { status: 400, error: "invalid_request" } });
      // An error is never cached.
      expect(result.headers).toBeUndefined();
    }
    // Refused before the digest was even looked for.
    expect(readDigest).not.toHaveBeenCalled();
    expectNoStoreUse(context);
  });

  it("answers 400 for a request with no query at all, as the static build makes", async () => {
    const context = setup({ env: {} });
    expect((await lookup(context, null, [])).status).toBe(400);
  });

  it("lists every segment with the address its audio would have, and asks the store nothing", async () => {
    const context = setup();
    const spoken = spokenSegments(context.digest);
    const result = await lookup(context);

    expect(result).toEqual({
      status: 200,
      // It depends on the build and the configuration alone, so the CDN may keep it for a minute.
      headers: { "Cache-Control": "public, s-maxage=60" },
      body: {
        status: 200,
        audio: null,
        timeline: null,
        segments: spoken.map((segment) => ({
          key: segment.key,
          item_id: segment.itemId,
          characters: segment.text.length,
          audio: {
            url: `${FAKE_BLOB_HOST}/${pathOf(context.digest, segment.key)}`,
            duration_ms: Math.round(segment.text.length * MS_PER_CHARACTER),
            confirmed: false,
          },
        })),
        ms_per_character: MS_PER_CHARACTER,
      },
    });
    // The intro, then the four stories in the order they are spoken, then the sign-off.
    expect(lookupBody(result).segments.map((segment) => segment.key)).toEqual([
      "intro",
      ...buildSpokenText(context.digest).ranges.map((range) => range.id),
      "outro",
    ]);
    expectNoStoreUse(context);
  });

  it("costs the store nothing however often it is asked, narrated or not", async () => {
    const context = setup();
    seedSegment(context, "intro");
    seedNarration(context);
    for (let request = 0; request < 50; request += 1) await lookup(context);
    expectNoStoreUse(context);
  });

  it("gives exactly the address a POST stores the segment at", async () => {
    const context = setup();
    const before = lookupBody(await lookup(context)).segments[0]?.audio;
    expect(before?.confirmed).toBe(false);
    const narrated = segmentBody(await postSegment(context, "intro"));
    expect(narrated.audio.url).toBe(before?.url);
    expect(narrated.audio.confirmed).toBe(true);
    // And the lookup cannot tell the difference: it still says unconfirmed.
    expect(lookupBody(await lookup(context)).segments[0]?.audio).toEqual(before);
  });

  it("follows the configured voice, since a segment's file is keyed by it", async () => {
    const usual = lookupBody(await lookup(setup())).segments[0]?.audio?.url;
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "henry_7" } });
    const other = lookupBody(await lookup(context)).segments[0]?.audio?.url;
    expect(other).toBe(`${FAKE_BLOB_HOST}/${pathOf(context.digest, "intro", "henry_7")}`);
    expect(other).not.toBe(usual);
  });

  describe("a briefing's voice comes from the schedule", () => {
    const WEEKLY_ID = "2026-10-11-weekly";
    const schedule = {
      version: 1,
      hour: 7,
      cadence_days: 2,
      sections: null,
      voice_id: "daily_v",
      weekly: { voice_id: "weekly_v" },
    };
    const withSchedule = (value: unknown, options: SetupOptions = {}) => {
      const context = setup(options);
      context.digests.readSchedule = async () => value;
      return context;
    };
    const firstUrl = async (context: Setup, id: string) =>
      lookupBody(await lookup(context, id)).segments[0]?.audio?.url;

    it("uses the daily voice for a daily briefing and the weekly voice for a weekly one", async () => {
      const weekly = makeDigest({ id: WEEKLY_ID, kind: "weekly" });
      const context = withSchedule(schedule, {
        env: { SPEECHIFY_VOICE_ID: "env_v" },
        digests: [makeDigest({ id: ID }), weekly],
      });
      const daily = await firstUrl(context, ID);
      expect(daily).toBe(`${FAKE_BLOB_HOST}/${pathOf(context.digest, "intro", "daily_v")}`);
      const week = await firstUrl(context, WEEKLY_ID);
      const key = segmentPath(
        WEEKLY_ID,
        "intro",
        segmentHash(segmentOf(weekly, "intro").text, "weekly_v", MODEL),
      );
      expect(week).toBe(`${FAKE_BLOB_HOST}/${key}`);
    });

    it("synthesizes with the schedule's voice and ignores a voice in the request", async () => {
      const context = withSchedule(schedule);
      await postSegment(context, "intro", { voice_id: "sneaky" });
      expect(context.speech.calls[0]?.body.voice_id).toBe("daily_v");
    });

    it("falls back to the server's voice when the schedule sets none or is unusable", async () => {
      for (const value of [null, { nonsense: true }, { ...schedule, voice_id: null }]) {
        const context = withSchedule(value, { env: { SPEECHIFY_VOICE_ID: "env_v" } });
        expect(await firstUrl(context, ID)).toBe(
          `${FAKE_BLOB_HOST}/${pathOf(context.digest, "intro", "env_v")}`,
        );
      }
    });
  });

  it("answers 503 when the configured voice is unusable", async () => {
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "two words" } });
    expect((await lookup(context)).status).toBe(503);
    expectNoStoreUse(context);
  });

  it("works the address out from the store id when there is no read-write token", async () => {
    const context = setup({
      env: { BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: "store_AbCd1234efgh" },
    });
    expect(lookupBody(await lookup(context)).segments[0]?.audio?.url).toBe(
      `https://abcd1234efgh.public.blob.vercel-storage.com/${pathOf(context.digest, "intro")}`,
    );
  });

  it("gives every segment null audio when the store's address cannot be worked out", async () => {
    for (const env of [
      { BLOB_READ_WRITE_TOKEN: undefined },
      { BLOB_READ_WRITE_TOKEN: "[SENSITIVE]" },
      { BLOB_READ_WRITE_TOKEN: "not-a-blob-token" },
      { BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: "store_../x" },
    ]) {
      const context = setup({ env });
      const found = lookupBody(await lookup(context));
      expect(found.segments).toHaveLength(6);
      expect(found.segments.every((segment) => segment.audio === null)).toBe(true);
      expect(found.segments[0]?.characters).toBeGreaterThan(0);
    }
  });

  it("never puts a credential in the answer", async () => {
    const context = setup();
    const answer = JSON.stringify(await lookup(context));
    expect(answer).not.toContain(BLOB_TOKEN);
    expect(answer).not.toContain("0123456789abcdefghij");
  });

  it("answers 404 for a digest this deployment does not have", async () => {
    const context = setup();
    expect(await lookup(context, "2026-10-09")).toEqual({
      status: 404,
      body: { status: 404, error: "digest_not_found" },
    });
    expectNoStoreUse(context);
  });

  it("answers 422 for a digest that cannot be read aloud", async () => {
    const long = makeDigest({
      id: ID,
      items: [1, 2, 3, 4].map((seed) => makeItem(seed, "top", { summary: "word ".repeat(1200) })),
    });
    const context = setup({ digests: [long] });
    expect((await lookup(context)).status).toBe(422);
    expectNoStoreUse(context);
  });

  it("reports whole-digest audio only from what the build carries", async () => {
    const audio = { url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`, duration_ms: 12_000 };
    const narrated = makeDigest({ id: ID, audio });
    const context = setup({ digests: [narrated] });
    const timeline = makeTimeline(narrated);
    context.digests.timelines.set(ID, timeline);

    const found = lookupBody(await lookup(context));
    expect(found.audio).toEqual({ url: audio.url, duration_ms: timeline.duration_ms });
    expect(found.timeline).toEqual({
      kind: "marks",
      items: timeline.items,
      sections: timeline.sections,
    });
    expect(found.segments).toHaveLength(6);
    // Voice, model and character count are in the timeline file but are not the page's business.
    expect(JSON.stringify(found)).not.toContain("text_chars");
    expectNoStoreUse(context);
  });

  it("does not report a whole-digest narration that is only in the store", async () => {
    const context = setup();
    // Made by a POST after the build: the store has it, the build does not.
    seedNarration(context);
    const found = lookupBody(await lookup(context));
    expect(found.audio).toBeNull();
    expect(found.timeline).toBeNull();
    expectNoStoreUse(context);
  });

  it("reports no whole-digest audio without both the address and the timeline in the build", async () => {
    const audio = { url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`, duration_ms: 12_000 };
    // The address but no timeline.
    const addressOnly = setup({ digests: [makeDigest({ id: ID, audio })] });
    expect(lookupBody(await lookup(addressOnly)).audio).toBeNull();
    // A timeline for another digest.
    addressOnly.digests.timelines.set(ID, {
      ...makeTimeline(addressOnly.digest),
      digest: "2026-10-06",
    });
    expect(lookupBody(await lookup(addressOnly)).audio).toBeNull();
    // The timeline but no address.
    const timelineOnly = setup();
    timelineOnly.digests.timelines.set(ID, makeTimeline(timelineOnly.digest));
    expect(lookupBody(await lookup(timelineOnly)).audio).toBeNull();
  });

  it("needs no passphrase and no Speechify key, and spends nothing: no characters, no operations", async () => {
    const context = setup({
      env: { GENERATE_PASSPHRASE_HASH: undefined, SPEECHIFY_API_KEY: undefined },
    });
    expect((await lookup(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
    expect(context.blob.operations().advanced).toBe(0);
    expectNoStoreUse(context);
  });

  it("still answers when the bundled timeline cannot be read, without whole-digest audio", async () => {
    const context = setup();
    context.digests.readTimeline = async () => {
      throw new Error("chunk failed to load");
    };
    const found = lookupBody(await lookup(context));
    expect(found.audio).toBeNull();
    expect(found.segments).toHaveLength(6);
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
    expect(wholeBody(result).audio).toEqual({
      url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`,
      duration_ms: timeline.duration_ms,
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
    expect(context.blob.operations().advanced).toBe(0);
  });

  it("does not narrate over a digest the audio workflow already narrated", async () => {
    const context = setup();
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    context.digests.timelines.set(ID, makeTimeline(context.digest));
    expect((await post(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("answers 429 when the month's character budget has no room for the digest", async () => {
    const context = setup();
    // 90 percent of the default 500,000 is 450,000.
    seedState(context, 449_990);
    const result = await post(context);
    expect(result).toEqual({ status: 429, body: { status: 429, error: "monthly_budget" } });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
    // Refused before the marker: a refusal costs no advanced operation.
    expect(context.blob.operations().advanced).toBe(0);
    expect(context.logs.join("\n")).toContain("449990 characters used");
  });

  it("applies SPEECHIFY_MONTHLY_CHARS and the 90 percent rule", async () => {
    const whole = wholeChars(makeDigest({ id: ID }));
    // The digest fits under the allowance but not under 90 percent of it.
    const refused = setup({ env: { SPEECHIFY_MONTHLY_CHARS: String(whole + 1) } });
    expect((await post(refused)).status).toBe(429);
    const allowed = setup({ env: { SPEECHIFY_MONTHLY_CHARS: String(whole * 2) } });
    expect((await post(allowed)).status).toBe(200);
  });

  it("counts each month in its own document, so last month's total does not carry over", async () => {
    const context = setup();
    context.blob.seed(usageKey("2026-09"), stateDoc(449_990).replace(MONTH, "2026-09"));
    expect((await post(context)).status).toBe(200);
  });

  it("answers 503 rather than treat an unreadable document as an empty month", async () => {
    for (const broken of [
      "{ not json",
      JSON.stringify({ version: 1 }),
      stateDoc(5).replace(MONTH, "2026-09"),
    ]) {
      const context = setup();
      context.blob.seed(usageKey(MONTH), broken);
      expect((await post(context)).status).toBe(503);
      expect(context.speech.calls).toHaveLength(0);
      expect(context.blob.text(usageKey(MONTH))).toBe(broken);
    }
  });

  it("answers 429 on a full day, read from the same document, before any speech call", async () => {
    const context = setup();
    expect(NARRATE_DAILY_CAP).toBe(3);
    seedState(context, 900, fullDay);
    expect(await post(context)).toEqual({
      status: 429,
      headers: { "Retry-After": String(UNTIL_MIDNIGHT_S) },
      body: { status: 429, error: "daily_cap", retry_after_s: UNTIL_MIDNIGHT_S },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("does not count digests narrated on earlier days, or a marker that is in flight", async () => {
    const context = setup();
    seedState(context, 900, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: "2026-10-06", characters: 300 },
    });
    // Another digest is being narrated right now. Only the document counts toward the cap.
    context.blob.seed(markerKey("2026-10-04"), "{}", NOW - 1000);
    expect((await post(context)).status).toBe(200);
  });

  it("does not refuse a digest that is already charged, however full the day is", async () => {
    const context = setup();
    const whole = wholeChars(context.digest);
    seedState(context, 900 + whole, { ...fullDay, [ID]: { day: TODAY, characters: whole } });
    expect((await post(context)).status).toBe(200);
    // Charged before, so there is nothing to write for it now.
    expect(context.blob.changes()).not.toContain(`put ${usageKey(MONTH)}`);
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
    context.blob.failNext("head", 1, { error: new Error(`${UPSTREAM} ${BLOB_TOKEN}`) });
    const result = await post(context);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(context.speech.calls).toHaveLength(0);
    expectNothingLeaked(result, context.logs);
  });
});

describe("POST /api/narrate: the in-progress marker", () => {
  it("answers 409 while another request holds the marker, and leaves it alone", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - 5000);
    const left = Math.ceil((MARKER_TTL_MS - 5000) / 1000);
    expect(await post(context)).toEqual({
      status: 409,
      headers: { "Retry-After": String(left) },
      body: { status: 409, error: "in_progress", retry_after_s: left },
    });
    expect(context.speech.calls).toHaveLength(0);
    // Nothing was written: not the charge, and the marker is still the other request's.
    expect(context.blob.changes()).toEqual([]);
    expect(context.blob.has(markerKey(ID))).toBe(true);
  });

  it("takes the marker with a write that refuses to overwrite, so only one request can", async () => {
    const context = setup();
    await post(context);
    const claim = context.blob.calls.find((call) => call.pathname === markerKey(ID));
    expect(claim?.op).toBe("create");
    expect(
      context.blob.calls.some((call) => call.op === "put" && call.pathname === markerKey(ID)),
    ).toBe(false);
  });

  it("replaces a marker left by a function that was stopped, once it has expired", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - MARKER_TTL_MS - 1);
    expect((await post(context)).status).toBe(200);
    expect(context.blob.changes().slice(0, 2)).toEqual([
      `del ${markerKey(ID)}`,
      `create ${markerKey(ID)}`,
    ]);
    expect(context.speech.calls).toHaveLength(1);
    expect(context.blob.has(markerKey(ID))).toBe(false);
  });

  it("answers 409 when another request takes an expired marker's place first", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - MARKER_TTL_MS - 1);
    // The store says no to every claim: someone else got there between the delete and the write.
    context.blob.create = async () => false;
    const result = await post(context);
    expect(result.status).toBe(409);
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
  });

  it("looks for the audio again once it holds the marker, and does not narrate it twice", async () => {
    const context = setup();
    // Another request finishes this digest after the first look and before the marker is taken.
    const create = context.blob.create.bind(context.blob);
    context.blob.create = async (pathname, text, options) => {
      const created = await create(pathname, text, options);
      seedNarration(context);
      return created;
    };
    const result = await post(context);
    expect(wholeBody(result).audio.url).toBe(`${FAKE_BLOB_HOST}/audio/${ID}.mp3`);
    expect(context.speech.calls).toHaveLength(0);
    // Found before spending: nothing charged, and the marker given back.
    expect(context.blob.changes()).toEqual([`create ${markerKey(ID)}`, `del ${markerKey(ID)}`]);
  });

  it("does not let a delete that hangs hold back a finished answer", async () => {
    const context = setup();
    context.blob.hangNext("del", { prefix: "state/narrating-" });
    // The wait for the delete is over; the delete itself never answers.
    context.markerWait.abort();
    const result = await post(context);
    expect(result.status).toBe(200);
    expect(context.clocks).toContain(`marker:${MARKER_CLEAR_WAIT_MS}`);
    // The wait is shorter than the time kept free for answering.
    expect(MARKER_CLEAR_WAIT_MS).toBeLessThan(RESPONSE_MARGIN_MS);
  });

  it("lets only one of two contenders take over a stale marker, and only that one narrates", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - MARKER_TTL_MS - 1);

    // Both read the same stale marker. The second is then held until the first has replaced it
    // with a fresh one, which is the moment a plain delete would wipe out the winner's marker and
    // let the second narrate as well.
    let releaseSecond: () => void = () => {};
    const firstHasTakenOver = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let secondHasRead: () => void = () => {};
    const bothHaveRead = new Promise<void>((resolve) => {
      secondHasRead = resolve;
    });
    const head = context.blob.head.bind(context.blob);
    let markerReads = 0;
    context.blob.head = async (pathname) => {
      const entry = await head(pathname);
      if (pathname === markerKey(ID)) {
        markerReads += 1;
        if (markerReads === 1) {
          await bothHaveRead;
        } else {
          secondHasRead();
          await firstHasTakenOver;
        }
      }
      return entry;
    };
    const create = context.blob.create.bind(context.blob);
    context.blob.create = async (pathname, text, options) => {
      const created = await create(pathname, text, options);
      if (created && pathname === markerKey(ID)) releaseSecond();
      return created;
    };

    const results = await Promise.all([post(context), post(context)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(context.speech.calls).toHaveLength(1);
    expect(markerReads).toBe(2);
    // One charge, one MP3, and the stale marker was deleted exactly once before the takeover.
    const changes = context.blob.changes();
    expect(changes.filter((change) => change === `put ${usageKey(MONTH)}`)).toHaveLength(1);
    expect(changes.filter((change) => change === `put ${audioKey(ID)}`)).toHaveLength(1);
    expect(changes.filter((change) => change === `create ${markerKey(ID)}`)).toHaveLength(1);
    expect(changes.slice(0, 2)).toEqual([`del ${markerKey(ID)}`, `create ${markerKey(ID)}`]);
  });

  it("returns the audio even when the marker cannot be cleared", async () => {
    const context = setup();
    context.blob.failNext("del", 1);
    expect((await post(context)).status).toBe(200);
    expect(context.logs.join("\n")).toContain("will expire");
  });
});

describe("POST /api/narrate: narrating the whole digest", () => {
  it("charges the digest, then narrates and stores the MP3, then the timeline", async () => {
    const context = setup();
    const spoken = buildSpokenText(context.digest);
    const result = await post(context);

    expect(context.blob.changes()).toEqual([
      // The marker, then the charge before a character is synthesized, then what was paid for.
      `create ${markerKey(ID)}`,
      `put ${usageKey(MONTH)}`,
      `put ${audioKey(ID)}`,
      `put ${timelineKey(ID)}`,
      `del ${markerKey(ID)}`,
    ]);
    // Four advanced operations: the marker, the charge, the MP3, the timeline.
    expect(context.blob.operations().advanced).toBe(4);

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
      timeoutMs: BLOB_UPLOAD_TIMEOUT_MS,
    });
    expect(context.blob.written(timelineKey(ID))?.contentType).toBe("application/json");
    const stored = AudioTimeline.parse(JSON.parse(context.blob.text(timelineKey(ID)) ?? ""));
    expect(stored.digest).toBe(ID);
    expect(stored.text_chars).toBe(spoken.text.length);
    // Asking again returns the same narration from the store, and Speechify is not asked twice.
    expect(wholeBody(await post(context))).toEqual(narrated);
    expect(context.speech.calls).toHaveLength(1);
    // Narrating the whole digest makes no segment files.
    expect(context.blob.paths(`audio/${ID}/seg/`)).toEqual([]);

    // The one document: the total, and the digest with its day, its voice and what it was charged.
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: spoken.text.length },
      digests: { [ID]: { day: TODAY, characters: spoken.text.length, ...AS_WHOLE } },
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
    expect(context.deadlines[0]).toBe(SYNTHESIS_DEADLINE_MS);
  });

  it("uses fixed inputs whatever the caller sends", async () => {
    const context = setup();
    await post(context, body({ text: "say this instead", voice_id: "other", model: "big" }));
    const call = context.speech.calls[0];
    expect(call?.body.input).toBe(buildSpokenText(context.digest).text);
    expect(call?.body.voice_id).toBe(VOICE);
    expect(call?.body.model).toBe(MODEL);
  });

  it("adds the digest to the month's document without disturbing what is there", async () => {
    const context = setup();
    const other = { "2026-10-01": { day: "2026-10-01", characters: 1000 } };
    seedState(context, 1000, other);
    await post(context);
    const whole = wholeChars(context.digest);
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: 1000 + whole },
      digests: { ...other, [ID]: { day: TODAY, characters: whole, ...AS_WHOLE } },
    });
  });

  it("falls back to the plain stream and an estimated timeline when marks are unavailable", async () => {
    const context = setup({ speech: { kind: "no_marks" } });
    const narrated = wholeBody(await post(context));
    expect(narrated.audio.duration_ms).toBe(4000);
    expect(narrated.timeline.kind).toBe("estimated");
    expect(context.blob.bytes(audioKey(ID))).toEqual(FAKE_PLAIN_AUDIO);
    expect(context.speech.calls.map((call) => call.url)).toEqual([
      "https://api.speechify.ai/v1/audio/stream/with-timestamps",
      "https://api.speechify.ai/v1/audio/stream",
    ]);
  });

  it("logs the timings the function limits have to be set from", async () => {
    const context = setup();
    // Speechify takes five seconds in this run; everything else is instant.
    const fetchSpeech = context.deps.fetch;
    context.deps.fetch = async (url, init) => {
      const response = await fetchSpeech(url, init);
      context.advance(5000);
      return response;
    };
    await post(context);
    expect(context.logs.at(-1)).toMatch(
      /stored\. \d+ characters, synthesis 5000 ms, upload 0 ms, total 5000 ms, marks timeline$/,
    );
  });
});

describe("POST /api/narrate: time limits, counted from the start of the request", () => {
  /** Makes the first store call of the request take this long. */
  function slowStart(context: Setup, milliseconds: number) {
    const head = context.blob.head.bind(context.blob);
    let first = true;
    context.blob.head = async (pathname) => {
      if (first) {
        first = false;
        context.advance(milliseconds);
      }
      return head(pathname);
    };
  }

  /** Makes Speechify take this long to answer. */
  function slowSpeech(context: Setup, milliseconds: number) {
    const fetchSpeech = context.deps.fetch;
    context.deps.fetch = async (url, init) => {
      const response = await fetchSpeech(url, init);
      context.advance(milliseconds);
      return response;
    };
  }

  it("gives Speechify less time when the request started slowly, never the overhead reserve", async () => {
    const context = setup();
    slowStart(context, 5000);
    expect((await post(context)).status).toBe(200);
    // 20 seconds in all, 8 kept back, 5 already gone: 7 left for synthesis, not the usual 12.
    expect(context.deadlines[0]).toBe(7000);
    expect(context.deadlines[0]).toBeLessThan(SYNTHESIS_DEADLINE_MS);
  });

  it("does not start synthesis at all when the time for it is already gone", async () => {
    const context = setup();
    slowStart(context, 11_500);
    const result = await postSegment(context, "intro");
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.deadlines).toEqual([]);
  });

  it("gives an upload no longer than the function has left", async () => {
    const context = setup();
    slowSpeech(context, 15_000);
    expect((await postSegment(context, "intro")).status).toBe(200);
    // 20 seconds, less the margin kept for answering, less the 15 gone, not the usual 6.
    expect(context.blob.written(pathOf(context.digest, "intro"))?.timeoutMs).toBe(
      5000 - RESPONSE_MARGIN_MS,
    );
  });

  it("does not start an upload it could not finish before the function is stopped", async () => {
    const context = setup();
    slowSpeech(context, 19_000);
    const result = await postSegment(context, "intro");
    expect(result).toEqual({ status: 502, body: { status: 502, error: "storage_failed" } });
    expect(context.blob.has(pathOf(context.digest, "intro"))).toBe(false);
    expect(context.logs.join("\n")).toContain("no time left to upload");
    // Nor is there time to count the failed attempt, and the log says what went uncounted.
    expect(context.logs.join("\n")).toContain("no time left to count");
  });

  const LIMIT_MS = FUNCTION_MAX_DURATION_S * 1000;

  it("never pauses before an upload retry for longer than the time that is left", async () => {
    const context = setup();
    // 2.4 seconds are left for uploads when Speechify answers, and every upload fails.
    slowSpeech(context, LIMIT_MS - RESPONSE_MARGIN_MS - 2400);
    context.blob.failNext("put", 10, { prefix: `audio/${ID}/seg/` });
    const result = await postSegment(context, "intro");

    expect(result).toEqual({ status: 502, body: { status: 502, error: "storage_failed" } });
    // The usual pauses, 500 then 1,000 ms, fit: they were taken, and the clock moved with them.
    expect(context.delays).toEqual([UPLOAD_RETRY_DELAY_MS, UPLOAD_RETRY_DELAY_MS * 2]);
    // The answer leaves with the margin for answering still untouched.
    expect(context.elapsed()).toBeLessThanOrEqual(LIMIT_MS - RESPONSE_MARGIN_MS);
  });

  it("cuts the pause short, or gives up at once, when the usual pause would not fit", async () => {
    const context = setup();
    // 900 ms are left. A 500 ms pause would leave too little for another attempt.
    slowSpeech(context, LIMIT_MS - RESPONSE_MARGIN_MS - 900);
    context.blob.failNext("put", 10, { prefix: `audio/${ID}/seg/` });
    const result = await postSegment(context, "intro");

    expect(result).toEqual({ status: 502, body: { status: 502, error: "storage_failed" } });
    // One shortened pause of 400 ms, a second attempt with what was left, then no third.
    expect(context.delays).toEqual([400]);
    expect(
      context.blob.calls.filter((call) => call.op === "put" && call.pathname.includes("/seg/")),
    ).toHaveLength(2);
    expect(context.elapsed()).toBeLessThanOrEqual(LIMIT_MS - RESPONSE_MARGIN_MS);
  });

  it("gives the store calls before synthesis one bound between them", async () => {
    for (const request of [post, (context: Setup) => postSegment(context, "intro")]) {
      const context = setup();
      // The first store call never answers, and the shared clock runs out.
      context.blob.hangNext("head");
      context.setupClock.abort();
      const result = await request(context);
      expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
      expect(context.clocks).toContain(`setup:${PRE_SYNTHESIS_BOUND_MS}`);
      expect(context.speech.calls).toHaveLength(0);
      expect(context.blob.changes()).toEqual([]);
    }
  });
});

describe("POST /api/narrate: when synthesis fails", () => {
  it("answers 502, clears the marker, hides the upstream body, and leaves the digest charged", async () => {
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
      `create ${markerKey(ID)}`,
      // The charge before synthesis, and the failed attempt counted after it.
      `put ${usageKey(MONTH)}`,
      `put ${usageKey(MONTH)}`,
      `del ${markerKey(ID)}`,
    ]);
    // The counter must never read below what was spent. The charge paid for this attempt; what
    // was added pays for the retry, which will have Speechify read the same text again.
    const whole = wholeChars(context.digest);
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: 2 * whole },
      digests: { [ID]: { day: TODAY, characters: whole, ...AS_WHOLE, repeats: whole } },
    });
    expect(context.logs.join("\n")).toContain("HTTP 500");
    expectNothingLeaked(result, context.logs);
  });

  it("counts every retry of a whole digest that fails after reaching Speechify", async () => {
    const context = setup({ speech: { kind: "http_error", status: 500, body: {} } });
    const whole = wholeChars(context.digest);
    await post(context);
    expect(stateOf(context).speechify.characters).toBe(2 * whole);
    await post(context);
    await post(context);
    // Three attempts reached Speechify. The counter holds the charge and three failures: one
    // attempt more than was made, never one less.
    expect(context.speech.calls).toHaveLength(3);
    expect(stateOf(context).speechify.characters).toBe(4 * whole);
    expect(stateOf(context).digests[ID]?.repeats).toBe(3 * whole);

    // When it then succeeds, nothing more is added.
    context.deps.fetch = createFakeSpeechify().fetch;
    expect((await post(context)).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(4 * whole);
  });

  it("does not count a failure that never reached Speechify", async () => {
    const context = setup();
    context.blob.failNext("put", 1, { prefix: "state/usage-" });
    expect((await post(context)).status).toBe(503);
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
    expect(context.clocks.some((clock) => clock.startsWith("repeat:"))).toBe(false);
  });

  it("still answers when the failed attempt cannot be counted, and says so in the log", async () => {
    const context = setup({ speech: { kind: "http_error", status: 500, body: {} } });
    // The charge is written; the count after the failure is not.
    const put = context.blob.put.bind(context.blob);
    let usageWrites = 0;
    context.blob.put = async (pathname, bytes, options) => {
      if (pathname === usageKey(MONTH)) {
        usageWrites += 1;
        if (usageWrites === 2) throw new Error(`${UPSTREAM} ${BLOB_TOKEN}`);
      }
      return put(pathname, bytes, options);
    };
    const result = await post(context);
    expect(result).toEqual({ status: 502, body: { status: 502, error: "synthesis_failed" } });
    expect(context.logs.join("\n")).toContain("could not be counted");
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
      `create ${markerKey(ID)}`,
      `put ${usageKey(MONTH)}`,
      `put ${usageKey(MONTH)}`,
      `del ${markerKey(ID)}`,
    ]);
    expect(context.blob.has(audioKey(ID))).toBe(false);
    // Charged in full beforehand, which covers the five words the stream did synthesize, and
    // once more for the retry a timeout invites.
    expect(stateOf(context).speechify.characters).toBe(2 * wholeChars(context.digest));
    const spent = wordMarks(buildSpokenText(context.digest).text)[4]?.end;
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
    // The pauses took real time, and each attempt was given what was then left of its limit.
    expect(context.elapsed()).toBe(UPLOAD_RETRY_DELAY_MS * 3);
    expect(context.blob.written(audioKey(ID))?.timeoutMs).toBe(BLOB_UPLOAD_TIMEOUT_MS);
    // A success adds nothing to the charge.
    expect(stateOf(context).speechify.characters).toBe(wholeChars(context.digest));
    expect(
      context.blob.calls.filter((call) => call.op === "put" && call.pathname === audioKey(ID)),
    ).toHaveLength(UPLOAD_ATTEMPTS);
    // Paid for once: the retries re-send the same audio.
    expect(context.speech.calls).toHaveLength(1);
  });

  it("retries the timeline upload too", async () => {
    const context = setup();
    context.blob.failNext("put", 1, { prefix: "timeline/" });
    expect((await post(context)).status).toBe(200);
    expect(context.delays).toEqual([UPLOAD_RETRY_DELAY_MS]);
  });

  it("gives up after the last attempt: 502, marker cleared, digest still charged", async () => {
    const context = setup();
    context.blob.failNext("put", UPLOAD_ATTEMPTS, {
      prefix: "audio/",
      error: new Error(`${UPSTREAM}: store rejected ${BLOB_TOKEN}`),
    });
    const result = await post(context);
    expect(result).toEqual({ status: 502, body: { status: 502, error: "storage_failed" } });
    expect(context.blob.has(audioKey(ID))).toBe(false);
    expect(context.blob.has(timelineKey(ID))).toBe(false);
    expect(context.blob.has(markerKey(ID))).toBe(false);
    expect(context.blob.changes().at(-1)).toBe(`del ${markerKey(ID)}`);
    // Speechify was paid and the audio is lost: the retry will pay again, so it is counted now.
    expect(stateOf(context).speechify.characters).toBe(2 * wholeChars(context.digest));
    // The pauses between the attempts were real ones.
    expect(context.delays).toEqual([UPLOAD_RETRY_DELAY_MS, UPLOAD_RETRY_DELAY_MS * 2]);
    expect(context.elapsed()).toBe(UPLOAD_RETRY_DELAY_MS * 3);
    expectNothingLeaked(result, context.logs);
  });

  it("does not take an MP3 without its timeline for a narration", async () => {
    const context = setup();
    context.blob.failNext("put", UPLOAD_ATTEMPTS, { prefix: "timeline/" });
    expect((await post(context)).status).toBe(502);
    expect(context.blob.has(audioKey(ID))).toBe(true);
    // The MP3 alone is not a narration: the next request finds nothing usable and starts again.
    expect((await post(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(2);
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
      {
        status: 503,
        arrange: (context) => {
          seedState(context, 10);
          context.blob.failNext("fetch", 1, { error: leaky });
        },
      },
      { status: 503, arrange: (context) => context.blob.failNext("create", 1, { error: leaky }) },
      {
        status: 503,
        arrange: (context) =>
          context.blob.failNext("put", 1, { prefix: "state/usage-", error: leaky }),
      },
      { status: 502, arrange: () => {}, speech: { kind: "throw", error: leaky } },
      {
        status: 502,
        arrange: (context) =>
          context.blob.failNext("put", UPLOAD_ATTEMPTS, { prefix: "audio/", error: leaky }),
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

  it("does not synthesize anything when the charge cannot be written", async () => {
    const context = setup();
    context.blob.failNext("put", 1, { prefix: "state/usage-" });
    expect((await post(context)).status).toBe(503);
    expect(context.speech.calls).toHaveLength(0);
    // The marker it took is given back.
    expect(context.blob.has(markerKey(ID))).toBe(false);
  });
});

describe("POST /api/narrate with a segment", () => {
  const segmentPuts = (context: Setup) =>
    context.blob.changes().filter((change) => change.startsWith(`put audio/${ID}/seg/`));

  /**
   * Makes two requests truly overlap. Each is held at its look for the segment's file until both
   * have looked, so both have read the month's document and neither has written anything yet.
   */
  function holdUntilBothHaveLooked(context: Setup) {
    const head = context.blob.head.bind(context.blob);
    const waiting: Array<() => void> = [];
    context.blob.head = async (pathname) => {
      const entry = await head(pathname);
      if (pathname.startsWith(`audio/${ID}/seg/`)) {
        await new Promise<void>((release) => {
          waiting.push(release);
          if (waiting.length === 2) for (const go of waiting) go();
        });
      }
      return entry;
    };
  }

  it("charges the digest once, narrates that one segment, and returns it", async () => {
    const context = setup();
    const intro = segmentOf(context.digest, "intro");
    const path = pathOf(context.digest, "intro");
    // The duration is the one the stream's done event reports.
    const durationMs = wordMarks(intro.text).length * MS_PER_WORD;

    const result = await postSegment(context, "intro");
    expect(result).toEqual({
      status: 200,
      body: {
        status: 200,
        segment: {
          key: "intro",
          item_id: null,
          characters: intro.text.length,
          audio: { url: `${FAKE_BLOB_HOST}/${path}`, duration_ms: durationMs, confirmed: true },
        },
      },
    });
    expect(path).toMatch(/^audio\/2026-10-07\/seg\/intro\.[0-9a-f]{12}\.mp3$/);

    // Speechify read the intro and nothing else.
    expect(context.speech.calls).toHaveLength(1);
    expect(context.speech.calls[0]?.body.input).toBe(intro.text);

    // The charge first, then the file. No marker and no whole-digest files.
    expect(context.blob.changes()).toEqual([`put ${usageKey(MONTH)}`, `put ${path}`]);
    expect(context.blob.operations()).toEqual({ advanced: 2, simple: 2, free: 0 });
    expect(context.blob.bytes(path)).toEqual(FAKE_AUDIO);
    expect(context.blob.written(path)).toEqual({
      contentType: "audio/mpeg",
      cacheSeconds: 30 * 24 * 3600,
      timeoutMs: BLOB_UPLOAD_TIMEOUT_MS,
    });
    expect(context.blob.has(audioKey(ID))).toBe(false);

    // The digest is charged for ALL of its text, though only the intro was narrated.
    const whole = wholeChars(context.digest);
    expect(whole).toBeGreaterThan(intro.text.length);
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: whole },
      digests: { [ID]: { day: TODAY, characters: whole, ...IN_SEGMENTS } },
    });
    expect(lookupBody(await lookup(context)).segments[0]?.audio?.url).toBe(
      segmentBody(result).audio.url,
    );
  });

  it("writes no state for the later segments of a digest", async () => {
    const context = setup();
    const keys = spokenSegments(context.digest).map((segment) => segment.key);
    for (const key of keys) expect((await postSegment(context, key)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(keys.length);
    expect(segmentPuts(context)).toHaveLength(keys.length);
    // Five segments, one digest, one charge, written once.
    expect(
      context.blob.changes().filter((change) => change === `put ${usageKey(MONTH)}`),
    ).toHaveLength(1);
    expect(stateOf(context).speechify.characters).toBe(wholeChars(context.digest));
    // One advanced operation per segment, and one for the charge.
    expect(context.blob.operations().advanced).toBe(keys.length + 1);
  });

  it("narrates a story with the section's bridge when it opens a later section", async () => {
    const context = setup();
    const spoken = buildSpokenText(context.digest);
    // The first story of the second section, which the host bridges into.
    const second = must(spoken.sectionStarts[1]);
    const own = must(spoken.ranges.find((range) => range.section === second.slug));
    const key = own.id;
    const story = segmentOf(context.digest, key);
    const narrated = segmentBody(await postSegment(context, key));
    expect(narrated.item_id).toBe(key);
    expect(narrated.characters).toBe(story.text.length);
    expect(context.speech.calls[0]?.body.input).toBe(story.text);
    // More than the story's own text: the bridge into its section comes first.
    expect(story.text.length).toBeGreaterThan(own.end - own.start);
    expect(story.text.endsWith(spoken.text.slice(own.start, own.end))).toBe(true);
  });

  it("narrates the sign-off as the outro, a segment with no story", async () => {
    const context = setup();
    const outro = segmentOf(context.digest, "outro");
    expect(outro.itemId).toBeNull();
    expect(outro.text).toBe("That's the briefing. More in two days.");
    const narrated = segmentBody(await postSegment(context, "outro"));
    expect(narrated.item_id).toBeNull();
    expect(context.speech.calls[0]?.body.input).toBe(outro.text);
  });

  it("refuses an unknown segment before any store or speech call", async () => {
    const context = setup();
    for (const segment of ["ffffffffffff", "nope"]) {
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

  it("finds a narrated segment with a head, returns it as it is, and spends nothing", async () => {
    const context = setup();
    const seeded = seedSegment(context, "intro", { bytes: 44_000 });
    const result = await postSegment(context, "intro");
    expect(segmentBody(result)).toEqual({
      key: "intro",
      item_id: null,
      characters: seeded.segment.text.length,
      // No stream this time, so the duration is the one the file's size gives.
      audio: { url: seeded.audio.url, duration_ms: 2750, confirmed: true },
    });
    // Nothing spent: no characters, no writes, and not one advanced operation.
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
    expect(context.blob.calls).toContainEqual({ op: "head", pathname: seeded.path });
    expect(context.blob.operations()).toEqual({ advanced: 0, simple: 2, free: 0 });
    expect(context.blob.has(usageKey(MONTH))).toBe(false);
  });

  it("returns a narrated segment even when the month's document cannot be read", async () => {
    const context = setup();
    const seeded = seedSegment(context, "intro");
    context.blob.seed(usageKey(MONTH), "{ not json");
    expect(segmentBody(await postSegment(context, "intro")).audio.url).toBe(seeded.audio.url);
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
    expect(listed?.audio?.url).toBe(narrated.audio.url);

    // The text has not changed since, so asking again finds the new file and spends nothing.
    expect(segmentBody(await postSegment(context, key)).audio.url).toBe(narrated.audio.url);
    expect(context.speech.calls).toHaveLength(1);
  });

  it("charges an edited digest whose text grew the difference, and keeps its day", async () => {
    const context = setup();
    const whole = wholeChars(context.digest);
    // Narrated four days ago, when its text was 100 characters shorter.
    seedState(context, 5000, { [ID]: { day: "2026-10-03", characters: whole - 100 } });
    expect((await postSegment(context, "intro")).status).toBe(200);
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: 5100 },
      digests: { [ID]: { day: "2026-10-03", characters: whole, ...IN_SEGMENTS } },
    });
  });

  it("charges the digest again when the voice has changed, since every file is made again", async () => {
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "henry_7" } });
    const whole = wholeChars(context.digest);
    seedState(context, whole, { [ID]: { day: "2026-10-03", characters: whole, ...IN_SEGMENTS } });
    // The old voice's file is there; under the new voice's name there is none.
    seedSegment(context, "intro");

    expect((await postSegment(context, "intro")).status).toBe(200);
    expect(context.speech.calls[0]?.body.voice_id).toBe("henry_7");
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: 2 * whole },
      digests: {
        [ID]: {
          day: "2026-10-03",
          characters: whole,
          voice: "henry_7",
          whole: false,
          segments: true,
        },
      },
    });
    // The rest of the digest in the new voice is covered by that one charge.
    expect((await postSegment(context, storyKey(context.digest, 0))).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(2 * whole);
  });

  it("answers 503 without spending when the month's document exists but cannot be had", async () => {
    const context = setup();
    seedState(context, 449_000);
    // The store says the document is there; reading it comes back with nothing.
    context.blob.fetchText = async () => null;
    const result = await postSegment(context, "intro");
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    // Not taken for an empty month: nothing synthesized, nothing written over the document.
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
    expect((await post(context)).status).toBe(503);
    expect(context.speech.calls).toHaveLength(0);
    expect(stateOf(context).speechify.characters).toBe(449_000);
  });

  it("needs room in the budget for the whole digest before its first segment", async () => {
    const whole = wholeChars(makeDigest({ id: ID }));
    // 90 percent of the default 500,000 is 450,000.
    const fits = setup();
    seedState(fits, 450_000 - whole);
    expect((await postSegment(fits, "intro")).status).toBe(200);
    expect(stateOf(fits).speechify.characters).toBe(450_000);

    const oneShort = setup();
    seedState(oneShort, 450_000 - whole + 1);
    expect(await postSegment(oneShort, "intro")).toEqual({
      status: 429,
      body: { status: 429, error: "monthly_budget" },
    });
    expect(oneShort.speech.calls).toHaveLength(0);
    expect(oneShort.blob.changes()).toEqual([]);

    // A digest that is already charged is not refused by a budget that has since filled up.
    const charged = setup();
    seedState(charged, 450_000, { [ID]: { day: TODAY, characters: whole } });
    expect((await postSegment(charged, "intro")).status).toBe(200);
  });

  it("refuses a second digest on a full day before any speech call", async () => {
    // Three digests were first narrated today: a fourth is refused, whichever part is asked for.
    const fourth = setup();
    seedState(fourth, 900, fullDay);
    expect(await postSegment(fourth, "intro")).toEqual({
      status: 429,
      headers: { "Retry-After": String(UNTIL_MIDNIGHT_S) },
      body: { status: 429, error: "daily_cap", retry_after_s: UNTIL_MIDNIGHT_S },
    });
    expect(fourth.speech.calls).toHaveLength(0);
    expect(fourth.blob.changes()).toEqual([]);
    expect(fourth.blob.operations().advanced).toBe(0);

    // A digest that holds one of today's three places goes on, segment after segment.
    const holder = setup();
    const whole = wholeChars(holder.digest);
    seedState(holder, 600 + whole, {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      [ID]: { day: TODAY, characters: whole },
    });
    for (const segment of spokenSegments(holder.digest)) {
      expect((await postSegment(holder, segment.key)).status).toBe(200);
    }
    expect(holder.blob.changes()).not.toContain(`put ${usageKey(MONTH)}`);
  });

  it("stores both files and charges once when two segments of one digest overlap", async () => {
    const context = setup();
    holdUntilBothHaveLooked(context);
    const first = storyKey(context.digest, 0);
    const second = storyKey(context.digest, 1);
    const [a, b] = await Promise.all([postSegment(context, first), postSegment(context, second)]);
    expect(context.speech.calls).toHaveLength(2);

    // Neither request could undo the other: there is no shared record of segments to overwrite.
    const { segments } = lookupBody(await lookup(context));
    expect(segments.find((segment) => segment.key === first)?.audio?.url).toBe(
      segmentBody(a).audio.url,
    );
    expect(segments.find((segment) => segment.key === second)?.audio?.url).toBe(
      segmentBody(b).audio.url,
    );
    expect(segmentPuts(context)).toHaveLength(2);
    // Both found the digest uncharged and both wrote the charge. It is the same charge.
    expect(
      context.blob.changes().filter((change) => change === `put ${usageKey(MONTH)}`),
    ).toHaveLength(2);
    const whole = wholeChars(context.digest);
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: whole },
      digests: { [ID]: { day: TODAY, characters: whole, ...IN_SEGMENTS } },
    });
  });

  it("may synthesize twice when the same segment overlaps, but still charges once", async () => {
    const context = setup();
    holdUntilBothHaveLooked(context);
    const [a, b] = await Promise.all([
      postSegment(context, "intro"),
      postSegment(context, "intro"),
    ]);
    expect(segmentBody(a).audio.url).toBe(segmentBody(b).audio.url);
    // Neither saw the other's file, so both asked Speechify. One file is left.
    expect(context.speech.calls).toHaveLength(2);
    expect(context.blob.paths(`audio/${ID}/seg/`)).toHaveLength(1);
    expect(stateOf(context).speechify.characters).toBe(wholeChars(context.digest));
    expect(Object.keys(stateOf(context).digests)).toEqual([ID]);
  });

  it("leaves the digest charged when synthesis fails, counts the attempt, and stores no audio", async () => {
    const context = setup({
      speech: {
        kind: "http_error",
        status: 500,
        body: { error: { code: "internal", message: `${UPSTREAM} for key ${SPEECHIFY_KEY}` } },
      },
    });
    const result = await postSegment(context, "intro");
    expect(result).toEqual({ status: 502, body: { status: 502, error: "synthesis_failed" } });
    // The digest's charge, then this attempt's characters for the retry to come.
    expect(context.blob.changes()).toEqual([`put ${usageKey(MONTH)}`, `put ${usageKey(MONTH)}`]);
    const whole = wholeChars(context.digest);
    const intro = segmentOf(context.digest, "intro").text.length;
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: whole + intro },
      digests: { [ID]: { day: TODAY, characters: whole, ...IN_SEGMENTS, repeats: intro } },
    });
    expect(context.logs.join("\n")).toContain(`narrate ${ID} intro: synthesis failed`);
    expectNothingLeaked(result, context.logs);
  });

  it("counts each retry of a segment that keeps failing, and nothing once it succeeds", async () => {
    const context = setup({ speech: { kind: "http_error", status: 500, body: {} } });
    const whole = wholeChars(context.digest);
    const intro = segmentOf(context.digest, "intro").text.length;
    await postSegment(context, "intro");
    await postSegment(context, "intro");
    expect(context.speech.calls).toHaveLength(2);
    expect(stateOf(context).speechify.characters).toBe(whole + 2 * intro);

    context.deps.fetch = createFakeSpeechify().fetch;
    expect((await postSegment(context, "intro")).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(whole + 2 * intro);
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
    expect(segmentPuts(context)).toEqual([]);
    // A timeout invites a retry, so the attempt is counted like any other failure.
    const story = segmentOf(context.digest, storyKey(context.digest, 0)).text.length;
    expect(stateOf(context).speechify.characters).toBe(wholeChars(context.digest) + story);
  });

  it("retries the upload inside the function, and gives up with 502", async () => {
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
    expect(failed.blob.has(pathOf(failed.digest, "intro"))).toBe(false);
    // Paid for and lost: the retry pays again, so the attempt is counted.
    expect(stateOf(failed).speechify.characters).toBe(
      wholeChars(failed.digest) + segmentOf(failed.digest, "intro").text.length,
    );
    expectNothingLeaked(result, failed.logs);
  });

  it("takes the duration from the audio's size when the marks endpoint is unavailable", async () => {
    const context = setup({ speech: { kind: "no_marks" } });
    expect(segmentBody(await postSegment(context, "intro")).audio.duration_ms).toBe(4000);
  });

  it("does not synthesize anything when the charge cannot be written", async () => {
    const context = setup();
    context.blob.failNext("put", 1, { prefix: "state/usage-" });
    expect(await postSegment(context, "intro")).toEqual({
      status: 503,
      body: { status: 503, error: "unavailable" },
    });
    expect(context.speech.calls).toHaveLength(0);
  });

  it("answers 503 when the store cannot be reached, with nothing spent and nothing leaked", async () => {
    const leaky = new Error(`${UPSTREAM} ${SPEECHIFY_KEY} ${BLOB_TOKEN} ${passphraseHash}`);
    for (const op of ["head", "fetch"] as const) {
      const context = setup();
      seedState(context, 10);
      context.blob.failNext(op, 1, { error: leaky });
      const result = await postSegment(context, "intro");
      expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
      expect(context.speech.calls).toHaveLength(0);
      expect(context.logs.join("\n")).toContain("[redacted]");
      expectNothingLeaked(result, context.logs);
    }
  });

  it("logs the timings a segment took", async () => {
    const context = setup();
    await postSegment(context, "intro");
    expect(context.logs.at(-1)).toMatch(
      /^narrate 2026-10-07 intro: stored\. \d+ characters, synthesis \d+ ms, upload \d+ ms, total \d+ ms$/,
    );
  });
});

describe("POST /api/narrate: the month's document is always read fresh", () => {
  const A = makeDigest({ id: "2026-10-05" });
  const B = makeDigest({ id: "2026-10-06" });
  const C = makeDigest({ id: ID });
  const firstSegment = (context: Setup, digest: string) =>
    postSegment(context, "intro", { digest });

  it("loses no charge behind a CDN that answers a URL it has seen from its cache", async () => {
    const context = setup({ digests: [A, B, C], cdn: true });
    for (const digest of [A, B, C]) {
      expect((await firstSegment(context, digest.id)).status).toBe(200);
    }
    // Each request read the document its predecessor wrote, so all three charges are there.
    expect(stateOf(context).speechify.characters).toBe(
      wholeChars(A) + wholeChars(B) + wholeChars(C),
    );
    expect(Object.keys(stateOf(context).digests).sort()).toEqual([A.id, B.id, C.id]);
  });

  it("would have lost one by the plain URL, which is what the version in the URL prevents", async () => {
    const context = setup({ digests: [A, B, C], cdn: true });
    await firstSegment(context, A.id);
    // The CDN sees the plain URL now, while the document holds one digest.
    const plain = context.blob.url(usageKey(MONTH));
    expect(JSON.parse((await context.blob.fetchText(plain)) ?? "{}").digests).toHaveProperty(A.id);
    await firstSegment(context, B.id);
    await firstSegment(context, C.id);

    // The plain URL still answers with that first copy: two digests behind.
    const stale = JSON.parse((await context.blob.fetchText(plain)) ?? "{}");
    expect(Object.keys(stale.digests)).toEqual([A.id]);
    // Read the way the function reads it, the document is current.
    const fresh = await readFresh(context.blob, usageKey(MONTH));
    if (!fresh) throw new Error("the month's document is missing");
    expect(Object.keys(JSON.parse(fresh.text).digests).sort()).toEqual([A.id, B.id, C.id]);
    // The difference is the version in the query, which the CDN has never seen before.
    expect(versionedUrl(fresh.entry)).toBe(`${plain}?v=${fresh.entry.version}`);
  });

  it("reads an unchanged document from the CDN's cache, which costs nothing", async () => {
    const context = setup({ cdn: true });
    const keys = spokenSegments(context.digest).map((segment) => segment.key);
    for (const key of keys) await postSegment(context, key);
    const fetches = context.blob.calls.filter((call) => call.op === "fetch");
    // Four later segments read the document. Only the first of them had to go to the store.
    expect(fetches).toHaveLength(keys.length - 1);
    expect(context.blob.operations().free).toBe(keys.length - 2);
  });
});

describe("what narrating a digest story by story costs the store", () => {
  it("stays at or under 22 advanced operations for a 20-segment digest, lookup included", async () => {
    const big = makeDigest({
      id: ID,
      items: Array.from({ length: 18 }, (_, index) =>
        makeItem(index + 1, index % 2 === 0 ? "top" : "ai"),
      ),
    });
    const context = setup({ digests: [big], cdn: true });

    // Play is pressed: one lookup, then every segment in order, one request at a time.
    const { segments } = lookupBody(await lookup(context));
    // The intro, eighteen stories and the sign-off.
    expect(segments).toHaveLength(20);
    // The lookup itself cost nothing.
    expect(context.blob.operations()).toEqual(NO_OPERATIONS);
    for (const segment of segments) {
      const narrated = segmentBody(await postSegment(context, segment.key));
      // Each file lands exactly where the lookup said it would be.
      expect(narrated.audio.url).toBe(segment.audio?.url);
    }

    const cost = context.blob.operations();
    // The month's charge, and twenty files.
    expect(cost.advanced).toBe(21);
    expect(cost.advanced).toBeLessThanOrEqual(22);
    // Two heads a request, and one read of the document that was not a cache hit.
    expect(cost.simple).toBe(2 * 20 + 1);

    // Listening again, lookups and all, costs no advanced operation and no characters.
    for (let visit = 0; visit < 3; visit += 1) {
      const again = lookupBody(await lookup(context));
      for (const segment of again.segments) {
        expect(segmentBody(await postSegment(context, segment.key)).audio.confirmed).toBe(true);
      }
    }
    expect(context.blob.operations().advanced).toBe(21);
    expect(context.speech.calls).toHaveLength(20);
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

    // The segment's file is still there, and still what a request for it returns.
    expect(context.blob.has(intro.path)).toBe(true);
    expect(segmentBody(await postSegment(context, "intro")).audio.url).toBe(intro.audio.url);
    expect(context.speech.calls).toHaveLength(1);
  });

  it("does not hold up a segment while the whole digest is being narrated", async () => {
    const context = setup();
    context.blob.seed(markerKey(ID), "{}", NOW - 5000);
    expect((await post(context)).status).toBe(409);
    expect((await postSegment(context, "intro")).status).toBe(200);
    // The whole-digest marker is not the segment's to clear.
    expect(context.blob.has(markerKey(ID))).toBe(true);
  });

  it("charges a digest for each way it is narrated: segments, then again as one file", async () => {
    const context = setup();
    const whole = wholeChars(context.digest);
    expect((await postSegment(context, "intro")).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(whole);

    // Speechify reads the whole text again for the one file, so it is charged again.
    expect((await post(context)).status).toBe(200);
    expect(stateOf(context)).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: 2 * whole },
      digests: {
        [ID]: { day: TODAY, characters: whole, voice: VOICE, whole: true, segments: true },
      },
    });

    // Both ways are paid for now: more of either adds nothing.
    expect((await postSegment(context, storyKey(context.digest, 0))).status).toBe(200);
    expect((await post(context)).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(2 * whole);
  });

  it("charges the reverse too: one file first, then segments", async () => {
    const context = setup();
    const whole = wholeChars(context.digest);
    expect((await post(context)).status).toBe(200);
    expect(stateOf(context).digests[ID]).toEqual({ day: TODAY, characters: whole, ...AS_WHOLE });
    expect((await postSegment(context, "intro")).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(2 * whole);
    expect((await postSegment(context, storyKey(context.digest, 0))).status).toBe(200);
    expect(stateOf(context).speechify.characters).toBe(2 * whole);
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
