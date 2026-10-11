import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DeadlineExceededError } from "../src/llm/errors.js";
import { failureReason, withModelChain } from "../src/llm/failoverClient.js";
import {
  type ChatApi,
  type ChatCallOptions,
  createNebiusLlm,
  requestTimeoutMs,
} from "../src/llm/nebiusClient.js";
import { withRetry } from "../src/llm/retry.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import { captureLog, FakeLlm, httpError, NO_WAIT } from "./write-fakes.js";

const Out = z.object({ items: z.array(z.object({ id: z.string() })) });
const request = (extra: { maxTokens?: number; deadlineAt?: number } = {}) => ({
  schema: Out,
  schemaName: "out",
  messages: [{ role: "user" as const, content: "x" }],
  label: "test",
  ...extra,
});
const good = () => ({ items: [] });
const okReply = { choices: [{ message: { content: '{"items":[]}' } }] };

describe("a provider that fails", () => {
  it("is logged with its status and error class, never its message", async () => {
    const first = new FakeLlm(() => {
      throw httpError(401, "invalid x-api-key sk-ant-SECRET");
    }, "claude");
    const env = new FakeLlm(good, "qwen");
    const { log, lines } = captureLog();
    const client = withModelChain([first, env], log, { firstIsTentative: true });
    await client.completeJson(request());
    const warn = lines.find((line) => line.level === "warn");
    expect(warn?.data).toMatchObject({
      from: "claude",
      to: "qwen",
      status: 401,
      error_class: "Error",
      kind: "authentication",
    });
    expect(JSON.stringify(lines)).not.toContain("SECRET");
    expect(JSON.stringify(lines)).not.toContain("x-api-key");
  });

  it("is skipped for the rest of the run, so later stages go straight to the one that works", async () => {
    const first = new FakeLlm(() => {
      throw httpError(400, "bad request");
    }, "claude");
    const env = new FakeLlm(good, "qwen");
    const { log, lines } = captureLog();
    const client = withModelChain([first, env], log, { firstIsTentative: true });
    for (let stage = 0; stage < 4; stage++) await client.completeJson(request());
    expect(first.calls).toHaveLength(1);
    expect(env.calls).toHaveLength(4);
    expect(lines.filter((line) => line.level === "warn")).toHaveLength(1);
  });

  it("names a kind for each common failure", () => {
    expect(failureReason(httpError(404, "model not found")).kind).toBe("model_not_found");
    expect(failureReason(httpError(429)).kind).toBe("rate_limited");
    expect(failureReason(httpError(529)).kind).toBe("server_error");
    expect(failureReason(httpError(400, "max_tokens too large")).kind).toBe("rejected_request");
    const timeout = Object.assign(new Error("t"), { name: "APITimeoutError" });
    expect(failureReason(timeout)).toEqual({
      status: null,
      error_class: "APITimeoutError",
      kind: "timeout",
    });
  });
});

/** A ChatApi that records the timeout of each call and answers from `answer`. */
function timedApi(answer: (call: number) => unknown): ChatApi & { timeouts: number[] } {
  const timeouts: number[] = [];
  return {
    timeouts,
    async createChatCompletion(_body, options?: ChatCallOptions) {
      timeouts.push(options?.timeoutMs ?? -1);
      const value = answer(timeouts.length - 1);
      if (value instanceof Error) throw value;
      return value as typeof okReply;
    },
  };
}

describe("the request timeout", () => {
  it("keeps 60 seconds for an ordinary reply and grows for a long script", () => {
    expect(requestTimeoutMs(400)).toBe(60_000);
    expect(requestTimeoutMs(1_500)).toBe(60_000);
    // A 15 minute script asks for about 6,400 tokens.
    expect(requestTimeoutMs(6_400)).toBeGreaterThan(150_000);
    expect(requestTimeoutMs(6_400)).toBeGreaterThan(requestTimeoutMs(4_500));
    expect(requestTimeoutMs(100_000)).toBe(240_000);
  });

  it("is sent with each request, sized from the reply asked for", async () => {
    const api = timedApi(() => okReply);
    const llm = createNebiusLlm({ api, model: "m", budget: new TokenBudget(1e9), retry: NO_WAIT });
    await llm.completeJson(request());
    await llm.completeJson(request({ maxTokens: 6_400 }));
    expect(api.timeouts).toEqual([60_000, requestTimeoutMs(6_400)]);
  });

  it("is cut to what is left before the caller's deadline", async () => {
    const clock = 5_000;
    const api = timedApi(() => okReply);
    const llm = createNebiusLlm({
      api,
      model: "m",
      budget: new TokenBudget(1e9),
      retry: NO_WAIT,
      now: () => clock,
    });
    await llm.completeJson(request({ maxTokens: 6_400, deadlineAt: clock + 20_000 }));
    expect(api.timeouts).toEqual([20_000]);
  });
});

describe("the total retry time", () => {
  it("stops retrying timeouts once the retry window has passed", async () => {
    let clock = 0;
    const api = timedApi((_call) => {
      // Every attempt runs into its timeout.
      clock += 60_000;
      return Object.assign(new Error("timed out"), { name: "APITimeoutError" });
    });
    const llm = createNebiusLlm({
      api,
      model: "m",
      budget: new TokenBudget(1e9),
      retry: NO_WAIT,
      now: () => clock,
    });
    await expect(llm.completeJson(request())).rejects.toMatchObject({ name: "APITimeoutError" });
    // Two timeouts fill the window of two timeouts; four retries would have made it five calls.
    expect(api.timeouts).toHaveLength(2);
  });

  it("does not send at all once the deadline has passed", async () => {
    const api = timedApi(() => okReply);
    const llm = createNebiusLlm({
      api,
      model: "m",
      budget: new TokenBudget(1e9),
      retry: NO_WAIT,
      now: () => 10_000,
    });
    await expect(llm.completeJson(request({ deadlineAt: 9_000 }))).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
    expect(api.timeouts).toHaveLength(0);
  });

  it("withRetry starts no retry that would begin after the deadline", async () => {
    let clock = 0;
    let calls = 0;
    const run = withRetry(
      async () => {
        calls += 1;
        clock += 1_000;
        throw httpError(503);
      },
      {
        ...NO_WAIT,
        baseDelayMs: 500,
        deadlineAt: 2_200,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    await expect(run).rejects.toMatchObject({ status: 503 });
    // 0 to 1,000 the first call, 500 wait, 1,500 to 2,500 the second; a third would start after.
    expect(calls).toBe(2);
  });
});
