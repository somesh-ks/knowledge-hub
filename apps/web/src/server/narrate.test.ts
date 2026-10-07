import { AudioTimeline, type Digest, serializeDigestFile } from "@dispatch/core";
import { hashPassphrase, verifyPassphrase } from "@dispatch/core/passphrase";
import { buildSpokenText } from "@dispatch/engine/audio";
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
import type { NarrateResponse } from "../types/contracts";
import type { BlobCredentials, ServerEnv } from "./config";
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
  NARRATION_CACHE_CONTROL,
  type NarrateDeps,
  parseDigestId,
  parseNarrateRequest,
  startDeadline,
  timelineKey,
  UPLOAD_ATTEMPTS,
  UPLOAD_RETRY_DELAY_MS,
  usageKey,
} from "./narrate";

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

/** Asserts that neither the answer nor the log carries a secret, and the answer carries no upstream text. */
function expectNothingLeaked(result: ApiResult<NarrateResponse>, logs: string[]) {
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

  it("answers 404 when the digest has no audio, and does not let that be cached", async () => {
    const context = setup();
    const result = await lookup(context);
    expect(result).toEqual({ status: 404, body: { status: 404, error: "no_audio" } });
    expect(result.headers).toBeUndefined();
  });

  it("answers 404 when there is audio but no timeline for it", async () => {
    const context = setup();
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    expect((await lookup(context)).status).toBe(404);
  });

  it("returns the audio and the timeline, field by field", async () => {
    const context = setup();
    const timeline = seedNarration(context);
    const result = await lookup(context);
    expect(result).toEqual({
      status: 200,
      headers: { "Cache-Control": NARRATION_CACHE_CONTROL },
      body: {
        status: 200,
        audio: { url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`, duration_ms: timeline.duration_ms },
        timeline: { kind: "marks", items: timeline.items, sections: timeline.sections },
      },
    });
    // Voice, model and character count are stored but are not the page's business.
    expect(JSON.stringify(result.body)).not.toContain("text_chars");
  });

  it("needs no passphrase, no Speechify key and spends nothing", async () => {
    const context = setup({
      env: { GENERATE_PASSPHRASE_HASH: undefined, SPEECHIFY_API_KEY: undefined },
    });
    seedNarration(context);
    expect((await lookup(context)).status).toBe(200);
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("uses the committed timeline for a digest the audio workflow narrated", async () => {
    const context = setup();
    const timeline = makeTimeline(context.digest);
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    context.digests.timelines.set(ID, timeline);
    const result = await lookup(context);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ audio: { duration_ms: timeline.duration_ms } });
  });

  it("ignores a timeline that is malformed or belongs to another digest", async () => {
    const context = setup();
    context.blob.seed(audioKey(ID), FAKE_AUDIO);
    context.blob.seed(timelineKey(ID), "{ not json");
    context.digests.timelines.set(ID, { ...makeTimeline(context.digest), digest: "2026-10-06" });
    expect((await lookup(context)).status).toBe(404);
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
    context.blob.failNext("head", 1, {
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

  it("answers 429 at the daily cap, counted from the uploads in the store", async () => {
    const context = setup();
    expect(NARRATE_DAILY_CAP).toBe(3);
    context.blob.seed(audioKey("2026-10-01"), FAKE_AUDIO, NOW - 1 * HOUR);
    context.blob.seed(audioKey("2026-10-02"), FAKE_AUDIO, NOW - 5 * HOUR);
    context.blob.seed(audioKey("2026-10-03"), FAKE_AUDIO, NOW - 20 * HOUR);
    expect(await post(context)).toEqual({
      status: 429,
      headers: { "Retry-After": String(4 * 3600) },
      body: { status: 429, error: "daily_cap", retry_after_s: 4 * 3600 },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("does not count uploads older than a day, or files that are not narrations", async () => {
    const context = setup();
    context.blob.seed(audioKey("2026-10-01"), FAKE_AUDIO, NOW - 1 * HOUR);
    context.blob.seed(audioKey("2026-10-02"), FAKE_AUDIO, NOW - 5 * HOUR);
    context.blob.seed(audioKey("2026-10-03"), FAKE_AUDIO, NOW - 25 * HOUR);
    context.blob.seed("audio/notes.txt", "x", NOW - 1 * HOUR);
    expect((await post(context)).status).toBe(200);
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
      `put ${markerKey(ID)}`,
      `put ${audioKey(ID)}`,
      `put ${timelineKey(ID)}`,
      `put ${usageKey(MONTH)}`,
      `del ${markerKey(ID)}`,
    ]);

    const durationMs = wordMarks(spoken.text).length * MS_PER_WORD;
    expect(result.status).toBe(200);
    expect(result.headers).toBeUndefined();
    if (result.body.status !== 200) throw new Error("expected a narration");
    expect(result.body.audio).toEqual({
      url: `${FAKE_BLOB_HOST}/audio/${ID}.mp3`,
      duration_ms: durationMs,
    });
    expect(result.body.timeline.kind).toBe("marks");
    expect(result.body.timeline.items.map((item) => item.id)).toEqual(
      spoken.ranges.map((range) => range.id),
    );
    const starts = result.body.timeline.items.map((item) => item.start_ms);
    expect(starts[0]).toBeGreaterThan(0);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(result.body.timeline.items.at(-1)?.end_ms).toBe(durationMs);

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
    expect((await lookup(context)).body).toEqual(result.body);

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
    await post(context);
    expect(context.logs.at(-1)).toMatch(/stored\. \d+ characters, synthesis \d+ ms, upload \d+ ms/);
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
    expect(context.blob.changes()).toEqual([`put ${markerKey(ID)}`, `del ${markerKey(ID)}`]);
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
    expect(context.blob.changes()).toEqual([`put ${markerKey(ID)}`, `del ${markerKey(ID)}`]);
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
    expect((await lookup(context)).status).toBe(404);
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
