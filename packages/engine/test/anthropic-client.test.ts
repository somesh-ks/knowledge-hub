import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAnthropicLlm } from "../src/llm/anthropicClient.js";
import type { ChatApi, ChatApiResponse } from "../src/llm/nebiusClient.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import { createWriterLlm } from "../src/llm/writerLlm.js";
import { captureLog } from "./write-fakes.js";

const Out = z.object({ items: z.array(z.string()) });
const request = () => ({
  schema: Out,
  schemaName: "out",
  messages: [
    { role: "system" as const, content: "be brief" },
    { role: "user" as const, content: "go" },
  ],
  label: "test",
});

function reply(text: string, status = 200): Response {
  const body =
    status === 200
      ? { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }
      : { error: { type: "x", message: text } };
  return new Response(JSON.stringify(body), { status });
}

const env = loadEnv({ ANTHROPIC_API_KEY: "test-key-not-real" });
const budget = () => new TokenBudget(1_000_000);

describe("createAnthropicLlm", () => {
  it("posts to the Messages API and parses the first text block", async () => {
    const fetchMock = vi.fn(async () => reply('{"items":["a"]}'));
    const llm = createAnthropicLlm({
      env,
      model: "claude-haiku-5-5",
      budget: budget(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await llm.completeJson(request());
    expect(result.value).toEqual({ items: ["a"] });
    expect(result.usage.totalTokens).toBe(15);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-not-real");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.system).toBe("be brief");
    expect(sent.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
    expect(sent.response_format).toBeUndefined();
  });

  it("sends no temperature, which Claude Sonnet 5.5 refuses with a 400", async () => {
    const fetchMock = vi.fn(async () => reply('{"items":[]}'));
    const llm = createAnthropicLlm({
      env,
      model: "claude-sonnet-5-5",
      budget: budget(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    await llm.completeJson({ ...request(), temperature: 0.2 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("temperature");
  });

  it("leaves room to think on top of the reply, so thinking cannot cut the JSON off", async () => {
    const fetchMock = vi.fn(async () => reply('{"items":[]}'));
    const llm = createAnthropicLlm({
      env,
      model: "claude-sonnet-5-5",
      budget: budget(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    await llm.completeJson({ ...request(), maxTokens: 3_500 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).max_tokens).toBeGreaterThan(3_500 + 4_000);
  });

  it("retries a 429 and counts every request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply("slow down", 429))
      .mockResolvedValueOnce(reply('{"items":[]}'));
    let count = 0;
    const llm = createAnthropicLlm({
      env,
      model: "claude-haiku-5-5",
      budget: budget(),
      fetch: fetchMock as unknown as typeof fetch,
      onRequest: () => {
        count += 1;
      },
    });
    await llm.completeJson(request());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
  }, 20_000);

  it("surfaces a 404 with its status so the chain can skip it", async () => {
    const fetchMock = vi.fn(async () => reply("model: claude-gone", 404));
    const llm = createAnthropicLlm({
      env,
      model: "claude-gone",
      budget: budget(),
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(llm.completeJson(request())).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("needs ANTHROPIC_API_KEY", () => {
    expect(() =>
      createAnthropicLlm({ env: loadEnv({}), model: "claude-haiku-5-5", budget: budget() }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("createWriterLlm with the Anthropic provider", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dispatch-anthropic-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config/writer.json"),
      '{"version":1,"provider":"anthropic","model":"claude-sonnet-5-5"}\n',
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const nebius = (used: string[]): ChatApi => ({
    async createChatCompletion(body): Promise<ChatApiResponse> {
      used.push(String(body.model));
      return {
        choices: [{ message: { content: '{"items":["nebius"]}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    },
  });

  it("leads with the Claude model", async () => {
    const used: string[] = [];
    const fetchMock = vi.fn(async () => reply('{"items":["claude"]}'));
    const llm = createWriterLlm({
      root,
      env: loadEnv({ ANTHROPIC_API_KEY: "k", DISPATCH_MODEL: "env-a" }),
      api: nebius(used),
      budget: budget(),
      log: captureLog().log,
      anthropicFetch: fetchMock as unknown as typeof fetch,
    });
    expect(llm.model).toBe("claude-sonnet-5-5");
    const result = await llm.completeJson(request());
    expect(result.value.items).toEqual(["claude"]);
    expect(used).toEqual([]);
  });

  it("falls through to the Nebius environment model when Anthropic fails", async () => {
    const used: string[] = [];
    const fetchMock = vi.fn(async () => reply("overloaded", 400));
    const llm = createWriterLlm({
      root,
      env: loadEnv({ ANTHROPIC_API_KEY: "k", DISPATCH_MODEL: "env-a" }),
      api: nebius(used),
      budget: budget(),
      log: captureLog().log,
      anthropicFetch: fetchMock as unknown as typeof fetch,
    });
    const result = await llm.completeJson(request());
    expect(result.value.items).toEqual(["nebius"]);
    expect(used).toEqual(["env-a"]);
    expect(llm.model).toBe("env-a");
  });
});
