import { describe, expect, it, vi } from "vitest";
import { handleAnthropicModels } from "./anthropicModels";
import type { FetchLike } from "./github";

// Made up, and one of the invented values .gitleaks.toml already names.
const KEY = "key-123456789";

const reply = (status: number, body: unknown): FetchLike =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("handleAnthropicModels", () => {
  // The bug: a model Anthropic releases never reaches the picker, or a non-Claude id slips in.
  it("serves every claude- model Anthropic lists, in its order, with its name", async () => {
    const fetch = reply(200, {
      data: [
        { id: "claude-opus-6", display_name: "Claude Opus 6", type: "model" },
        { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", type: "model" },
        { id: "not-claude", display_name: "Other" },
        { id: "claude-haiku-5-5" },
      ],
    });
    const result = await handleAnthropicModels({ env: { ANTHROPIC_API_KEY: KEY }, fetch });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      provider: "anthropic",
      models: [
        { id: "claude-opus-6", label: "Claude Opus 6" },
        { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
        { id: "claude-haiku-5-5", label: "claude-haiku-5-5" },
      ],
    });
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
  });

  // The bug: a failure is cached at the CDN, or the key or Anthropic's words reach a reply or a log.
  it("is unavailable and uncached without a key or on an error, and says nothing of it", async () => {
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);
    const noKey = await handleAnthropicModels({ env: {}, fetch: reply(200, { data: [] }), log });
    const failed = await handleAnthropicModels({
      env: { ANTHROPIC_API_KEY: KEY },
      fetch: reply(401, { error: `bad key ${KEY}` }),
      log,
    });
    for (const result of [noKey, failed]) {
      expect(result).toMatchObject({ status: 503, headers: { "Cache-Control": "no-store" } });
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
    expect(logs.join(" ")).not.toContain(KEY);
  });
});
