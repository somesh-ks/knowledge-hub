import { HOST_NAME_POOLS, hostNamesFor } from "@dispatch/core/hosts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./github";
import {
  byteRange,
  handleVoiceSample,
  handleVoices,
  hostVoiceIds,
  parseVoices,
  readVoiceCatalogue,
  resetVoicesCache,
  resolveHostNames,
  SAMPLE_MAX_BYTES,
  VOICES_CACHE_CONTROL,
  VOICES_TTL_MS,
  voiceDefaults,
} from "./voices";

// Made up, and one of the invented values .gitleaks.toml already names.
const KEY = "key-123456789";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const voice = (id: string, name: string, locale = "en-US", extra: object = {}) => ({
  id,
  display_name: name,
  gender: "female",
  locale,
  ...extra,
});

beforeEach(() => resetVoicesCache());

describe("parseVoices", () => {
  it("keeps English voices, finds a locale inside models, and takes only https previews", () => {
    const out = parseVoices({
      voices: [
        voice("b", "Beta", "en-GB", { preview_audio: "https://cdn.example/b.mp3" }),
        voice("f", "Fran", "fr-FR"),
        { id: "m", display_name: "Mia", models: [{ languages: [{ locale: "en-AU" }] }] },
        voice("p", "Pia", "en-US", { preview_audio: "data:audio/mp3;base64,AAAA" }),
        { display_name: "No id", locale: "en-US" },
      ],
    });
    expect(out.map((v) => [v.id, v.language, v.preview_url])).toEqual([
      ["b", "en-GB", "https://cdn.example/b.mp3"],
      ["m", "en-AU", null],
      ["p", "en-US", null],
    ]);
    expect(out[1]?.gender).toBe("");
  });
});

describe("handleVoices", () => {
  it("answers an empty list without a key, and does not call Speechify", async () => {
    const fetch: FetchLike = vi.fn();
    const result = await handleVoices({ env: {}, fetch });
    expect(result).toMatchObject({ status: 200, body: { voices: [] } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows next_cursor, sorts by name and sends the key only as a bearer token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, { voices: [voice("z", "Zed")], has_more: true, next_cursor: "c2" }),
      )
      .mockResolvedValueOnce(json(200, { voices: [voice("a", "Ada")], has_more: false }));
    const result = await handleVoices({ env: { SPEECHIFY_API_KEY: KEY }, fetch });
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({ "Cache-Control": VOICES_CACHE_CONTROL });
    expect(result.body).toEqual({
      voices: [
        { id: "a", name: "Ada", gender: "female", language: "en-US", preview_url: null },
        { id: "z", name: "Zed", gender: "female", language: "en-US", preview_url: null },
      ],
      defaults: { voice: "geffen_32", voice_b: "dominic_32" },
    });
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("cursor=c2");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("caches an hour in memory, then asks again", async () => {
    const fetch = vi.fn(async () => json(200, { voices: [voice("a", "Ada")] }));
    const env = { SPEECHIFY_API_KEY: KEY };
    await handleVoices({ env, fetch, now: () => 1000 });
    await handleVoices({ env, fetch, now: () => 1000 + VOICES_TTL_MS - 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await handleVoices({ env, fetch, now: () => 1000 + VOICES_TTL_MS });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("answers 502 and logs only the status when Speechify fails", async () => {
    const log = vi.fn();
    const fetch = vi.fn(async () => json(401, { message: `bad ${KEY}` }));
    const result = await handleVoices({ env: { SPEECHIFY_API_KEY: KEY }, fetch, log });
    expect(result).toMatchObject({ status: 502, body: { error: "unavailable" } });
    expect(log).toHaveBeenCalledWith("Speechify answered HTTP 401 for the voice list");
  });

  it("answers 502 when the request throws, without the error message", async () => {
    const log = vi.fn();
    const fetch = vi.fn(async () => {
      throw new Error(`boom ${KEY}`);
    });
    const result = await handleVoices({ env: { SPEECHIFY_API_KEY: KEY }, fetch, log });
    expect(result.status).toBe(502);
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });
});

describe("readVoiceCatalogue", () => {
  it("says there is no key without calling Speechify", async () => {
    const fetch = vi.fn<FetchLike>();
    expect(await readVoiceCatalogue({ env: {}, fetch })).toEqual({ kind: "no_key" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares one hour-long cache with the voice list", async () => {
    const fetch = vi.fn(async () => json(200, { voices: [voice("a", "Ada")] }));
    const deps = { env: { SPEECHIFY_API_KEY: KEY }, fetch, now: () => 1000 };
    expect(await readVoiceCatalogue(deps)).toMatchObject({ kind: "voices", voices: [{ id: "a" }] });
    expect(await handleVoices(deps)).toMatchObject({
      status: 200,
      body: { voices: [{ id: "a" }] },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a failure as failed and caches nothing", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(json(500, {}))
      .mockResolvedValueOnce(json(200, { voices: [voice("a", "Ada")] }));
    const deps = { env: { SPEECHIFY_API_KEY: KEY }, fetch };
    expect(await readVoiceCatalogue(deps)).toEqual({ kind: "failed" });
    expect(await readVoiceCatalogue(deps)).toMatchObject({ kind: "voices" });
  });
});

describe("hostVoiceIds", () => {
  it("takes the request's voices, else the defaults narration reads with", () => {
    expect(hostVoiceIds({ voice_id: "x", voice_id_b: "y" }, {})).toEqual({ a: "x", b: "y" });
    expect(hostVoiceIds({}, {})).toEqual({ a: "geffen_32", b: "dominic_32" });
    expect(hostVoiceIds({ voice_id: null, voice_id_b: null }, {})).toEqual({
      a: "geffen_32",
      b: "dominic_32",
    });
    expect(hostVoiceIds({ voice_id: "x" }, { SPEECHIFY_VOICE_ID_B: "leo_2" })).toEqual({
      a: "x",
      b: "leo_2",
    });
  });

  it("gives the second host the first host's voice when the second voice is blank", () => {
    expect(hostVoiceIds({ voice_id: "x" }, { SPEECHIFY_VOICE_ID_B: "" })).toEqual({
      a: "x",
      b: "x",
    });
  });
});

describe("resolveHostNames", () => {
  const catalogue = () =>
    json(200, {
      voices: [
        { ...voice("tom", "Tom Hardy"), gender: "male" },
        voice("nora", "nora"),
        { ...voice("geffen_32", "Geffen"), gender: "male" },
        { ...voice("dominic_32", "Dominic"), gender: "male" },
        { ...voice("sky", "Sky"), gender: "" },
      ],
      has_more: false,
    });
  const env = { SPEECHIFY_API_KEY: KEY };

  it("names the hosts after the genders of their voices", async () => {
    const log = vi.fn();
    const names = await resolveHostNames(
      { voice_id: "tom", voice_id_b: "nora" },
      { env, fetch: vi.fn(async () => catalogue()), log },
    );
    expect(names).toEqual(
      hostNamesFor(
        { id: "tom", name: "Tom Hardy", gender: "male" },
        { id: "nora", name: "nora", gender: "female" },
      ),
    );
    expect(HOST_NAME_POOLS.male).toContain(names?.a);
    expect(names?.b).toBe("Nora");
    expect(log).not.toHaveBeenCalled();
  });

  it("reads the default voices when the request names none", async () => {
    const fetch = vi.fn(async () => catalogue());
    expect(await resolveHostNames({}, { env, fetch })).toEqual({ a: "Geffen", b: "Dominic" });
  });

  it("gives two hosts read by one voice two names", async () => {
    const names = await resolveHostNames(
      { voice_id: "sky" },
      { env: { ...env, SPEECHIFY_VOICE_ID_B: "" }, fetch: vi.fn(async () => catalogue()) },
    );
    expect(names?.a).toBe("Sky");
    expect(HOST_NAME_POOLS.neutral).toContain(names?.b);
  });

  it("leaves the names to the engine when a voice is not in the list", async () => {
    const log = vi.fn();
    const fetch = vi.fn(async () => catalogue());
    expect(await resolveHostNames({ voice_id_b: "gone" }, { env, fetch, log })).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "Host names left to the engine: a host's voice is not in the voice list",
    );
  });

  it("leaves the names to the engine without a key, and calls nothing", async () => {
    const log = vi.fn();
    const fetch = vi.fn<FetchLike>();
    expect(await resolveHostNames({}, { env: {}, fetch, log })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Host names left to the engine: no Speechify key");
  });

  it("leaves the names to the engine when Speechify fails, logging only the kind", async () => {
    const log = vi.fn();
    const answered = vi.fn(async () => json(403, { message: `denied ${KEY}` }));
    expect(await resolveHostNames({}, { env, fetch: answered, log })).toBeUndefined();
    const thrown = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${KEY}`);
    });
    expect(await resolveHostNames({}, { env, fetch: thrown, log })).toBeUndefined();
    expect(log.mock.calls).toEqual([
      ["Speechify answered HTTP 403 for the voice list"],
      ["The voice list could not be read (TypeError)"],
    ]);
  });

  it("gives up on a slow list when its time runs out", async () => {
    const log = vi.fn();
    // Never answers: only the abort ends the wait.
    const fetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const names = await resolveHostNames({}, { env, fetch, log }, AbortSignal.timeout(20));
    expect(names).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(log).toHaveBeenCalledWith("The voice list could not be read (TimeoutError)");
  });
});

describe("voiceDefaults", () => {
  it("names the voices narration reads with when none is chosen", () => {
    expect(voiceDefaults({})).toEqual({ voice: "geffen_32", voice_b: "dominic_32" });
    expect(voiceDefaults({ SPEECHIFY_VOICE_ID: "ada_1", SPEECHIFY_VOICE_ID_B: "leo_2" })).toEqual({
      voice: "ada_1",
      voice_b: "leo_2",
    });
    // A blank second voice means the first reads both hosts.
    expect(voiceDefaults({ SPEECHIFY_VOICE_ID: "ada_1", SPEECHIFY_VOICE_ID_B: "" })).toEqual({
      voice: "ada_1",
      voice_b: "ada_1",
    });
  });
});

describe("handleVoiceSample", () => {
  const list = () =>
    json(200, {
      voices: [
        voice("b", "Beta", "en-GB", { preview_audio: "https://cdn.example/b.mp3" }),
        voice("n", "Nope", "en-GB"),
      ],
      has_more: false,
    });

  it("serves a listed voice's sample from the site, and fetches only that address", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(list())
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
      );
    const sample = await handleVoiceSample("b", { env: { SPEECHIFY_API_KEY: KEY }, fetch });
    expect(sample).toMatchObject({ kind: "audio", contentType: "audio/mpeg" });
    expect(sample.kind === "audio" && sample.body.byteLength).toBe(3);
    expect(fetch.mock.calls[1]?.[0]).toBe("https://cdn.example/b.mp3");
  });

  it("refuses a bad id, a voice without a sample and an oversized file", async () => {
    const env = { SPEECHIFY_API_KEY: KEY };
    expect(await handleVoiceSample("../x", { env, fetch: vi.fn<FetchLike>() })).toMatchObject({
      kind: "error",
      result: { status: 400 },
    });
    const missing = await handleVoiceSample("n", {
      env,
      fetch: vi.fn<FetchLike>().mockResolvedValueOnce(list()),
    });
    expect(missing).toMatchObject({ kind: "error", result: { status: 404 } });
    resetVoicesCache();
    const big = await handleVoiceSample("b", {
      env,
      fetch: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(list())
        .mockResolvedValueOnce(
          new Response("x", { headers: { "content-length": String(SAMPLE_MAX_BYTES + 1) } }),
        ),
    });
    expect(big).toMatchObject({ kind: "error", result: { status: 502 } });
  });
});

describe("byteRange", () => {
  it("reads the ranges Safari asks for before it plays", () => {
    expect(byteRange(null, 100)).toBeNull();
    expect(byteRange("bytes=0-1", 100)).toEqual([0, 1]);
    expect(byteRange("bytes=10-", 100)).toEqual([10, 99]);
    expect(byteRange("bytes=-20", 100)).toEqual([80, 99]);
    expect(byteRange("bytes=50-500", 100)).toEqual([50, 99]);
    expect(byteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(byteRange("items=0-1", 100)).toBeNull();
  });
});
