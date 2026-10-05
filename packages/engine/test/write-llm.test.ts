import { loadEnv } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapConcurrent } from "../src/llm/concurrency.js";
import { BudgetExceededError, describeError, LlmOutputError } from "../src/llm/errors.js";
import { isModelNotFound, withModelFailover } from "../src/llm/failoverClient.js";
import { type ChatApi, type ChatApiResponse, createNebiusLlm } from "../src/llm/nebiusClient.js";
import { createOpenAiChatApi } from "../src/llm/openAiChatApi.js";
import { parseModelJson } from "../src/llm/parseModelJson.js";
import {
  backoffDelayMs,
  DEFAULT_RETRY,
  isRetryable,
  serverDelayMs,
  withRetry,
} from "../src/llm/retry.js";
import { DEFAULT_THINKING_OFF, parseThinkingOff, thinkingParams } from "../src/llm/thinking.js";
import { estimateTokens, TokenBudget } from "../src/llm/tokenBudget.js";
import { newBoundary, scrubUntrusted, wrapUntrusted } from "../src/llm/untrusted.js";
import { captureLog, FakeLlm, httpError, NO_WAIT } from "./write-fakes.js";

const Out = z.object({ items: z.array(z.object({ id: z.string() })) });

type Reply = ChatApiResponse | Error;

/** A ChatApi that plays back replies in order and records every request body. */
function scriptedApi(replies: Reply[]): ChatApi & { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  return {
    bodies,
    async createChatCompletion(body) {
      bodies.push(structuredClone(JSON.parse(JSON.stringify(body))) as Record<string, unknown>);
      const next = replies.shift();
      if (!next) throw new Error("no scripted reply left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const reply = (
  content: string,
  usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
): ChatApiResponse => ({
  choices: [{ message: { content } }],
  usage,
});

const request = (label = "test") => ({
  schema: Out,
  schemaName: "out",
  messages: [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "usr" },
  ],
  label,
});

describe("retry", () => {
  it.each([
    [429, true],
    [529, true],
    [500, true],
    [503, true],
    [408, true],
    [401, false],
    [403, false],
    [400, false],
    [404, false],
    [422, false],
  ])("status %i retryable: %s", (status, expected) => {
    expect(isRetryable(httpError(status))).toBe(expected);
  });

  it("retries timeouts and dropped connections by name or code, but not budget errors", () => {
    const timeout = Object.assign(new Error("t"), { name: "APITimeoutError" });
    const reset = Object.assign(new Error("r"), { code: "ECONNRESET" });
    expect(isRetryable(timeout)).toBe(true);
    expect(isRetryable(reset)).toBe(true);
    expect(isRetryable(new Error("plain"))).toBe(false);
    expect(isRetryable(new BudgetExceededError(10, 9, 5))).toBe(false);
    expect(isRetryable("string")).toBe(false);
  });

  it("reads Retry-After from a plain object, a Headers instance and retryAfterMs", () => {
    expect(serverDelayMs(httpError(429, "x", { "retry-after": "3" }))).toBe(3000);
    expect(
      serverDelayMs(
        Object.assign(new Error("x"), { headers: new Headers({ "retry-after-ms": "250" }) }),
      ),
    ).toBe(250);
    expect(serverDelayMs(Object.assign(new Error("x"), { retryAfterMs: 1200 }))).toBe(1200);
    expect(serverDelayMs(new Error("x"))).toBeUndefined();
  });

  it("backs off exponentially with jitter, capped, and ignores absurd server delays", () => {
    const options = { ...DEFAULT_RETRY, baseDelayMs: 100, maxDelayMs: 1000, random: () => 0 };
    expect([0, 1, 2, 3, 4, 5].map((a) => backoffDelayMs(a, new Error("x"), options))).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ]);
    expect(backoffDelayMs(0, new Error("x"), { ...options, random: () => 1 })).toBe(75);
    expect(backoffDelayMs(0, httpError(429, "x", { "retry-after": "600" }), options)).toBe(100);
  });

  it("retries up to the limit then rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw httpError(529, `try ${calls}`);
        },
        { ...NO_WAIT, retries: 3 },
      ),
    ).rejects.toThrow("try 4");
    expect(calls).toBe(4);
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw httpError(422);
      }, NO_WAIT),
    ).rejects.toMatchObject({ status: 422 });
    expect(calls).toBe(1);
  });

  it("reports each retry to onRetry", async () => {
    const seen: number[] = [];
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw httpError(429);
        return "ok";
      },
      { ...NO_WAIT, onRetry: (info) => seen.push(info.attempt) },
    );
    expect(value).toBe("ok");
    expect(seen).toEqual([1, 2]);
  });
});

describe("token budget", () => {
  it("estimates at 3.5 characters per token, rounding up", () => {
    expect(estimateTokens("x".repeat(35))).toBe(10);
    expect(estimateTokens("x".repeat(36))).toBe(11);
    expect(estimateTokens("")).toBe(0);
  });

  it("allows requests that fit and aborts those that would pass the limit", () => {
    const budget = new TokenBudget(1000);
    budget.check(600);
    budget.record(600);
    expect(budget.used).toBe(600);
    expect(budget.remaining).toBe(400);
    expect(() => budget.check(401)).toThrow(BudgetExceededError);
    expect(() => budget.check(400)).not.toThrow();
  });

  it("names the variable in the message", () => {
    expect(() => new TokenBudget(10).check(11)).toThrow(/MAX_TOKENS_PER_RUN/);
  });
});

describe("mapConcurrent", () => {
  it("never exceeds the limit and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapConcurrent([5, 4, 3, 2, 1, 0, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n));
      inFlight -= 1;
      return n * 2;
    });
    expect(out).toEqual([10, 8, 6, 4, 2, 0, 12, 14]);
    expect(peak).toBe(3);
  });

  it("handles an empty list", async () => {
    expect(await mapConcurrent([], 4, async (x) => x)).toEqual([]);
  });
});

describe("parseModelJson", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['Here you go: {"a":1} thanks', { a: 1 }],
    ['<think>reasoning {with} braces</think>{"a":1}', { a: 1 }],
    ['{"a":"} not the end","b":[1,2]}', { a: "} not the end", b: [1, 2] }],
    ["[1,2]", [1, 2]],
  ])("parses %s", (raw, expected) => {
    expect(parseModelJson(raw)).toEqual(expected);
  });

  it("throws LlmOutputError when nothing parses", () => {
    expect(() => parseModelJson("no json here")).toThrow(LlmOutputError);
    expect(() => parseModelJson('{"a": ')).toThrow(LlmOutputError);
  });
});

describe("thinking control", () => {
  it("defaults to the documented reasoning_effort none", () => {
    expect(DEFAULT_THINKING_OFF).toEqual({ kind: "reasoning_effort", value: "none" });
    expect(thinkingParams(DEFAULT_THINKING_OFF)).toEqual({ reasoning_effort: "none" });
  });

  it("supports a template flag and omission", () => {
    expect(
      thinkingParams({
        kind: "extra_body",
        body: { chat_template_kwargs: { enable_thinking: false } },
      }),
    ).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(thinkingParams({ kind: "omit" })).toEqual({});
  });

  it.each([
    [undefined, { kind: "reasoning_effort", value: "none" }],
    ["", { kind: "reasoning_effort", value: "none" }],
    ["reasoning_effort:minimal", { kind: "reasoning_effort", value: "minimal" }],
    ["omit", { kind: "omit" }],
    ['extra:{"enable_thinking":false}', { kind: "extra_body", body: { enable_thinking: false } }],
  ])("parses %s", (spec, expected) => {
    expect(parseThinkingOff(spec)).toEqual(expected);
  });

  it("rejects unknown specs with a usable message", () => {
    expect(() => parseThinkingOff("reasoning_effort:turbo")).toThrow(/none, minimal or low/);
    expect(() => parseThinkingOff("extra:[1]")).toThrow(/JSON object/);
    expect(() => parseThinkingOff("sometimes")).toThrow(/Unrecognized/);
  });
});

describe("untrusted text", () => {
  it("makes unguessable boundaries", () => {
    const a = newBoundary();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(newBoundary()).not.toBe(a);
  });

  it("wraps text between markers and scrubs control characters and the boundary itself", () => {
    const boundary = "abcdef0123456789";
    const block = wrapUntrusted(`line\u0000 one ${boundary} two`, boundary, "id=x");
    expect(block).toBe(`<<<SOURCE-${boundary} id=x>>>\nline one  two\n<<<END-${boundary}>>>`);
    expect(scrubUntrusted("a\u0007b", boundary)).toBe("ab");
  });
});

describe("describeError", () => {
  it("uses fixed wording for authentication failures", () => {
    expect(describeError(httpError(401, "Incorrect API key sk-abc123456789"))).toBe(
      "Authentication failed (HTTP 401). Check the API key in .env.",
    );
  });

  it("redacts known secrets and truncates long messages", () => {
    const secret = "supersecretvalue1";
    const text = describeError(httpError(500, `boom ${secret} ${"x".repeat(500)}`), [secret]);
    expect(text).not.toContain(secret);
    expect(text).toContain("[redacted]");
    expect(text.length).toBeLessThan(300);
    expect(text.startsWith("Error (HTTP 500)")).toBe(true);
  });
});

/** The response_format type of a recorded request body. */
const formatType = (body: Record<string, unknown> | undefined): string | undefined =>
  (body?.response_format as { type?: string } | undefined)?.type;

describe("createNebiusLlm", () => {
  const make = (replies: Reply[], extra: Partial<Parameters<typeof createNebiusLlm>[0]> = {}) => {
    const api = scriptedApi(replies);
    const budget = new TokenBudget(100_000);
    const llm = createNebiusLlm({ api, model: "Qwen/Qwen3-32B", budget, retry: NO_WAIT, ...extra });
    return { api, budget, llm };
  };

  it("sends a strict json_schema request with temperature 0.2 and thinking off", async () => {
    const { api, llm } = make([reply('{"items":[{"id":"a"}]}')]);
    const result = await llm.completeJson({ ...request(), temperature: 0.2, maxTokens: 700 });
    expect(result.value).toEqual({ items: [{ id: "a" }] });
    const body = api.bodies[0] as Record<string, unknown>;
    expect(body.model).toBe("Qwen/Qwen3-32B");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(700);
    expect(body.reasoning_effort).toBe("none");
    const format = body.response_format as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: { properties: object } };
    };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.name).toBe("out");
    expect(format.json_schema.strict).toBe(true);
    expect(Object.keys(format.json_schema.schema.properties)).toEqual(["items"]);
  });

  it("also puts the schema in the prompt, as the Nebius docs recommend", async () => {
    const { api, llm } = make([reply('{"items":[]}')]);
    await llm.completeJson(request());
    const messages = api.bodies[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages.at(-1)?.content).toContain("JSON Schema");
    expect(messages.at(-1)?.content).toContain('"items"');
  });

  it("uses the configured thinking-off parameter", async () => {
    const { api, llm } = make([reply('{"items":[]}')], {
      thinkingOff: {
        kind: "extra_body",
        body: { chat_template_kwargs: { enable_thinking: false } },
      },
    });
    await llm.completeJson(request());
    expect(api.bodies[0]).toHaveProperty("chat_template_kwargs.enable_thinking", false);
    expect(api.bodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("records reported usage against the budget", async () => {
    const { budget, llm } = make([
      reply('{"items":[]}', { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 }),
    ]);
    const result = await llm.completeJson(request());
    expect(result.usage).toEqual({ promptTokens: 500, completionTokens: 100, totalTokens: 600 });
    expect(budget.used).toBe(600);
  });

  it("estimates usage when the provider reports none", async () => {
    const { budget, llm } = make([{ choices: [{ message: { content: '{"items":[]}' } }] }]);
    await llm.completeJson(request());
    expect(budget.used).toBeGreaterThan(0);
  });

  it("aborts before calling the API when the estimate would pass the budget", async () => {
    const api = scriptedApi([reply('{"items":[]}')]);
    const llm = createNebiusLlm({ api, model: "m", budget: new TokenBudget(100), retry: NO_WAIT });
    await expect(llm.completeJson({ ...request(), maxTokens: 500 })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(api.bodies).toHaveLength(0);
  });

  it("stops a run once cumulative usage reaches the limit", async () => {
    const api = scriptedApi([
      reply('{"items":[]}', { prompt_tokens: 900, completion_tokens: 50, total_tokens: 950 }),
      reply('{"items":[]}'),
    ]);
    const llm = createNebiusLlm({ api, model: "m", budget: new TokenBudget(1500), retry: NO_WAIT });
    await llm.completeJson({ ...request(), maxTokens: 100 });
    await expect(llm.completeJson({ ...request(), maxTokens: 600 })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("strips inline reasoning blocks and code fences", async () => {
    const { llm } = make([reply('<think>hmm</think>```json\n{"items":[{"id":"z"}]}\n```')]);
    expect((await llm.completeJson(request())).value.items[0]?.id).toBe("z");
  });

  it("retries once with the validation error appended, then succeeds", async () => {
    const { api, llm } = make([
      reply('{"items":[{"nope":1}]}'),
      reply('{"items":[{"id":"fixed"}]}'),
    ]);
    const result = await llm.completeJson(request());
    expect(result.value.items[0]?.id).toBe("fixed");
    expect(api.bodies).toHaveLength(2);
    const second = api.bodies[1]?.messages as Array<{ role: string; content: string }>;
    expect(second.at(-1)?.content).toContain("failed validation");
    expect(second.at(-1)?.content).toContain("items.0.id");
    expect(second.some((m) => m.role === "assistant")).toBe(true);
    expect(result.usage.totalTokens).toBe(300);
  });

  it("fails with LlmOutputError after the one corrective retry", async () => {
    const { api, llm } = make([reply("not json"), reply("still not json")]);
    await expect(llm.completeJson(request())).rejects.toThrow(LlmOutputError);
    expect(api.bodies).toHaveLength(2);
  });

  it("falls back to json_object for the rest of the run when the model rejects schemas", async () => {
    const { api, llm } = make([
      httpError(400, "response_format json_schema is not supported by this model"),
      reply('{"items":[]}'),
      reply('{"items":[]}'),
    ]);
    await llm.completeJson(request());
    await llm.completeJson(request());
    expect(formatType(api.bodies[0])).toBe("json_schema");
    expect(formatType(api.bodies[1])).toBe("json_object");
    expect(formatType(api.bodies[2])).toBe("json_object");
  });

  it("retries a 429 with backoff and then succeeds", async () => {
    const { api, llm } = make([httpError(429, "slow down"), reply('{"items":[]}')]);
    await llm.completeJson(request());
    expect(api.bodies).toHaveLength(2);
  });

  it("surfaces an authentication failure without retrying", async () => {
    const { api, llm } = make([httpError(401, "bad key")]);
    await expect(llm.completeJson(request())).rejects.toMatchObject({ status: 401 });
    expect(api.bodies).toHaveLength(1);
  });

  it("reports a refusal as an output error", async () => {
    const { llm } = make([
      { choices: [{ message: { content: null, refusal: "I cannot help with that." } }] },
    ]);
    await expect(llm.completeJson(request())).rejects.toThrow("refused");
  });

  it("logs retries without logging prompts", async () => {
    const { log, lines } = captureLog();
    const { llm } = make([httpError(529), reply('{"items":[]}')], { log });
    await llm.completeJson(request("writer"));
    expect(lines.some((l) => l.message.includes("retrying"))).toBe(true);
    expect(JSON.stringify(lines)).not.toContain("usr");
  });
});

describe("model failover", () => {
  it("recognizes model-not-found errors", () => {
    expect(isModelNotFound(httpError(404, "gone"))).toBe(true);
    expect(isModelNotFound(httpError(400, "The model `x` does not exist"))).toBe(true);
    expect(isModelNotFound(httpError(400, "bad schema"))).toBe(false);
    expect(isModelNotFound(httpError(429, "model overloaded"))).toBe(false);
  });

  it("switches to the fallback model once and stays there", async () => {
    const primary = new FakeLlm(() => {
      throw httpError(404, "model not found");
    }, "retired-model");
    const fallback = new FakeLlm(() => ({ items: [] }), "fallback-model");
    const { log, lines } = captureLog();
    const client = withModelFailover(primary, fallback, log);
    expect(client.model).toBe("retired-model");
    await client.completeJson(request());
    expect(client.model).toBe("fallback-model");
    await client.completeJson(request());
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(2);
    expect(lines.some((l) => l.level === "warn")).toBe(true);
  });

  it("rethrows other errors and works without a fallback", async () => {
    const primary = new FakeLlm(() => {
      throw httpError(500, "boom");
    });
    await expect(
      withModelFailover(primary, new FakeLlm(() => ({ items: [] }))).completeJson(request()),
    ).rejects.toMatchObject({ status: 500 });
    const lone = new FakeLlm(() => {
      throw httpError(404, "gone");
    });
    await expect(withModelFailover(lone, null).completeJson(request())).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("createOpenAiChatApi", () => {
  it("fails with a message that names the variable and never a value", () => {
    expect(() => createOpenAiChatApi(loadEnv({}))).toThrow("NEBIUS_API_KEY is not set");
  });

  it("builds an adapter when the key is present", () => {
    const api = createOpenAiChatApi(loadEnv({ NEBIUS_API_KEY: "nb-test-0123456789" }));
    expect(typeof api.createChatCompletion).toBe("function");
  });
});
