import { loadEnv, ModelRouting } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pickNewest, resolveFamilies } from "../src/llm/modelResolver.js";
import { createModelRouter } from "../src/llm/modelRouter.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import { captureLog, NO_WAIT } from "./write-fakes.js";

const routing = ModelRouting.parse({
  version: 1,
  families: {
    "claude-sonnet": { fallback_id: "claude-sonnet-5-5" },
    "gemini-flash": { fallback_id: "gemini-3.8-flash" },
  },
  steps: {
    story_writer: {
      chain: [{ family: "claude-sonnet", effort: "medium" }, { family: "gemini-flash" }],
    },
  },
});

const Out = z.object({ ok: z.boolean() });
const request = {
  schema: Out,
  schemaName: "out",
  messages: [{ role: "user" as const, content: "x" }],
  label: "test",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const claude = (stop_reason: string, text = '{"ok":true}') =>
  json({ stop_reason, content: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 3 } });
const gemini = (text = '{"ok":true}') =>
  json({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
  });

function setup(handler: (url: string, body: Record<string, unknown>) => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchFake: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    return handler(String(url), body);
  };
  const { log, lines } = captureLog();
  const env = loadEnv({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" });
  const fallbacks: string[] = [];
  const router = createModelRouter({
    routing,
    resolve: async () => ({
      "claude-sonnet": { family: "claude-sonnet", id: "claude-sonnet-5-5", source: "fallback" },
      "gemini-flash": { family: "gemini-flash", id: "gemini-3.8-flash", source: "fallback" },
    }),
    env,
    budget: new TokenBudget(100_000),
    log,
    fetch: fetchFake,
    retry: { ...NO_WAIT, retries: 0 },
    onFallback: (info) => fallbacks.push(`${info.from}>${info.to}:${info.kind}`),
  });
  return { router, calls, lines, fallbacks };
}

describe("the model chain", () => {
  // A refusal or an error that silently served from the wrong model once hid a broken writer for
  // days (a deprecated temperature made Sonnet fall back to Nebius unseen).
  it("moves to the next model on a refusal, says so loudly and records which model served", async () => {
    const { router, lines, fallbacks } = setup((url) =>
      url.includes("anthropic") ? claude("refusal", "") : gemini(),
    );
    const result = await router.callModel("story_writer", request);
    expect(result.served.model).toBe("gemini-3.8-flash");
    expect(result.served.fellBackFrom.map((f) => f.kind)).toEqual(["refusal"]);
    expect(fallbacks).toEqual(["claude-sonnet-5-5>gemini-3.8-flash:refusal"]);
    expect(lines.some((l) => l.level === "warn" && /falling back/i.test(l.message))).toBe(true);
    expect(router.lastServed().story_writer?.model).toBe("gemini-3.8-flash");
  });

  it("falls back on a server error and on invalid structured output, and fails naming every model", async () => {
    const down = setup((url) => (url.includes("anthropic") ? json({}, 529) : json({}, 500)));
    await expect(down.router.callModel("story_writer", request)).rejects.toThrow(
      /claude-sonnet-5-5 \(server_error\), gemini-3.8-flash \(server_error\)/,
    );
    const bad = setup((url) => (url.includes("anthropic") ? claude("end_turn", "not json") : gemini()));
    expect((await bad.router.callModel("story_writer", request)).served.family).toBe("gemini-flash");
  });

  it("never sends temperature, top_p, top_k or budget_tokens, and asks Claude for effort and a schema format", async () => {
    const { router, calls } = setup((url) => (url.includes("anthropic") ? claude("end_turn") : gemini()));
    await router.callModel("story_writer", request);
    const sent = calls.map((c) => JSON.stringify(c.body));
    for (const text of sent) expect(text).not.toMatch(/temperature|top_p|top_k|budget_tokens/);
    const body = calls[0]?.body as { output_config?: { effort?: string; format?: { type?: string } } };
    expect(body.output_config?.effort).toBe("medium");
    expect(body.output_config?.format?.type).toBe("json_schema");
  });
});

describe("the newest model of a family", () => {
  it("picks a new Sonnet, never an Opus, a preview or a Flash-Lite among Flash", () => {
    const ids = [
      "claude-sonnet-5-5",
      "claude-sonnet-5-6",
      "claude-opus-5-9",
      "claude-haiku-5-5",
      "gemini-3.8-flash",
      "gemini-4.0-flash-preview-0901",
      "gemini-4.0-flash-lite",
      "gemini-3.8-flash-live",
      "gemini-3.8-flash-tts",
      "gemini-3.5-flash-lite",
    ];
    expect(pickNewest("claude-sonnet", ids)).toBe("claude-sonnet-5-6");
    expect(pickNewest("claude-haiku", ids)).toBe("claude-haiku-5-5");
    expect(pickNewest("gemini-flash", ids)).toBe("gemini-3.8-flash");
    expect(pickNewest("gemini-flash-lite", ids)).toBe("gemini-4.0-flash-lite");
  });

  it("resolves from the provider lists, and uses the pinned id when listing fails", async () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" });
    const listed = await resolveFamilies({
      routing,
      env,
      log: captureLog().log,
      fetch: async (url) =>
        String(url).includes("anthropic")
          ? json({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-sonnet-5-7" }], has_more: false })
          : json({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] }),
    });
    expect(listed["claude-sonnet"]).toMatchObject({ id: "claude-sonnet-5-7", source: "listed" });
    const { log, lines } = captureLog();
    const failed = await resolveFamilies({ routing, env, log, fetch: async () => json({}, 500) });
    expect(failed["claude-sonnet"]).toMatchObject({ id: "claude-sonnet-5-5", source: "fallback" });
    expect(lines.some((l) => l.level === "warn")).toBe(true);
  });
});
