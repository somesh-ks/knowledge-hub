import { isTextModel } from "@dispatch/core";
import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./github";
import { handleModels, MODELS_CACHE_CONTROL } from "./nebiusModels";

// Made up, and one of the invented values .gitleaks.toml already names, so the secret scan passes
// without a new exception.
const KEY = "key-123456789";

const reply = (status: number, body: unknown): FetchLike =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("handleModels", () => {
  it("answers a sorted, filtered list with a CDN cache window", async () => {
    const fetch = reply(200, {
      data: [
        { id: "z/chat", max_model_len: 32768 },
        { id: "a/chat", context_length: 131072 },
        { id: "BAAI/bge-multilingual-gemma2" },
        { id: "black-forest-labs/flux-dev" },
        { id: "x/odd", type: "embedding" },
      ],
    });
    const result = await handleModels({ env: { NEBIUS_API_KEY: KEY }, fetch });
    expect(result.status).toBe(200);
    expect(result.headers).toEqual({ "Cache-Control": MODELS_CACHE_CONTROL });
    expect(MODELS_CACHE_CONTROL).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    expect(result.body).toEqual({
      provider: "nebius",
      models: [
        { id: "a/chat", context_length: 131072 },
        { id: "z/chat", context_length: 32768 },
      ],
    });
  });

  it("asks the configured base URL with the key as a bearer token and a timeout", async () => {
    const fetch = reply(200, { data: [] });
    await handleModels({
      env: { NEBIUS_API_KEY: KEY, NEBIUS_BASE_URL: "https://nebius.example/v1" },
      fetch,
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://nebius.example/v1/models?verbose=true");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses Nebius's own address when none is configured", async () => {
    const fetch = reply(200, { data: [] });
    await handleModels({ env: { NEBIUS_API_KEY: KEY }, fetch });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "https://api.tokenfactory.nebius.com/v1/models?verbose=true",
    );
  });

  it("is unavailable, and not cached, without a key", async () => {
    const fetch = reply(200, { data: [] });
    for (const env of [{}, { NEBIUS_API_KEY: "  " }]) {
      const result = await handleModels({ env, fetch });
      expect(result).toMatchObject({
        status: 503,
        body: { error: "unavailable" },
        headers: { "Cache-Control": "no-store" },
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is unavailable when Nebius answers an error, and says nothing of it", async () => {
    const logs: string[] = [];
    const fetch = reply(500, { error: `bad key ${KEY}` });
    const result = await handleModels({
      env: { NEBIUS_API_KEY: KEY },
      fetch,
      log: (message) => logs.push(message),
    });
    expect(result).toMatchObject({ status: 503, headers: { "Cache-Control": "no-store" } });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(logs.join(" ")).not.toContain(KEY);
    expect(logs.join(" ")).not.toContain("bad key");
  });

  it("is unavailable on a timeout or a network error, without logging the message", async () => {
    const logs: string[] = [];
    const fetch: FetchLike = async () => {
      throw new DOMException(`The operation timed out at ${KEY}`, "TimeoutError");
    };
    const result = await handleModels({
      env: { NEBIUS_API_KEY: KEY },
      fetch,
      log: (message) => logs.push(message),
    });
    expect(result.status).toBe(503);
    expect(logs).toHaveLength(1);
    expect(logs.join(" ")).not.toContain(KEY);
  });

  it("is unavailable when the reply is not a model list", async () => {
    const result = await handleModels({
      env: { NEBIUS_API_KEY: KEY },
      fetch: reply(200, { nope: true }),
    });
    expect(result.status).toBe(503);
  });

  it("filters exactly as the shared core filter does", async () => {
    const entries = [
      { id: "m/chat" },
      { id: "m/embed-v2" },
      { id: "m/rerank" },
      { id: "m/draw", type: "text2image" },
      { id: "m/talk", type: "audio" },
      { id: "m/ocr-1" },
      { id: "m/plain", type: "chat" },
    ];
    const result = await handleModels({
      env: { NEBIUS_API_KEY: KEY },
      fetch: reply(200, { data: entries }),
    });
    const served = (result.body as { models: { id: string }[] }).models.map((m) => m.id);
    expect(served).toEqual(
      entries
        .filter((entry) => isTextModel(entry))
        .map((entry) => entry.id)
        .sort(),
    );
  });
});
