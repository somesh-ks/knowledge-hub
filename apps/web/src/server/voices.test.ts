import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./github";
import {
  handleVoices,
  parseVoices,
  resetVoicesCache,
  VOICES_CACHE_CONTROL,
  VOICES_TTL_MS,
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
