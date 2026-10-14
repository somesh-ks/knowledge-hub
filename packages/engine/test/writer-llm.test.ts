import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { withModelChain } from "../src/llm/failoverClient.js";
import type { ChatApi, ChatApiResponse } from "../src/llm/nebiusClient.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import { createWriterLlm } from "../src/llm/writerLlm.js";
import { captureLog, FakeLlm, httpError } from "./write-fakes.js";

const Out = z.object({ items: z.array(z.object({ id: z.string() })) });
const request = () => ({
  schema: Out,
  schemaName: "out",
  messages: [{ role: "user" as const, content: "x" }],
  label: "test",
});
const good = () => ({ items: [] });

describe("withModelChain", () => {
  it("walks past retired models and stays on the one that works", async () => {
    const a = new FakeLlm(() => {
      throw httpError(404, "model not found");
    }, "a");
    const b = new FakeLlm(() => {
      throw httpError(404, "model not found");
    }, "b");
    const c = new FakeLlm(good, "c");
    const client = withModelChain([a, b, c]);
    await client.completeJson(request());
    expect(client.model).toBe("c");
    await client.completeJson(request());
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(c.calls).toHaveLength(2);
  });

  it("leaves a tentative first model on any failure, but not later ones", async () => {
    const first = new FakeLlm(() => {
      throw httpError(500, "boom");
    }, "settings");
    const env = new FakeLlm(good, "env");
    const { log, lines } = captureLog();
    const client = withModelChain([first, env], log, { firstIsTentative: true });
    await client.completeJson(request());
    expect(client.model).toBe("env");
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);

    const broken = new FakeLlm(() => {
      throw httpError(500, "boom");
    });
    const strict = withModelChain([new FakeLlm(good, "x"), broken], undefined, {
      firstIsTentative: true,
    });
    await expect(strict.completeJson(request())).resolves.toBeDefined();
  });

  it("does not skip on a plain error when the first model is not tentative", async () => {
    const first = new FakeLlm(() => {
      throw httpError(500, "boom");
    });
    const client = withModelChain([first, new FakeLlm(good)]);
    await expect(client.completeJson(request())).rejects.toMatchObject({ status: 500 });
  });

  it("throws the last model's error when every model fails", async () => {
    const a = new FakeLlm(() => {
      throw httpError(404, "gone");
    });
    const b = new FakeLlm(() => {
      throw httpError(404, "gone too");
    });
    await expect(withModelChain([a, b]).completeJson(request())).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("createWriterLlm", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dispatch-writer-"));
    await mkdir(join(root, "config"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A chat API that fails for the listed models with 404 and answers `{items: []}` otherwise. */
  function api(retired: string[], broken: string[] = []): ChatApi & { used: string[] } {
    const used: string[] = [];
    return {
      used,
      async createChatCompletion(body): Promise<ChatApiResponse> {
        const model = String(body.model);
        used.push(model);
        if (retired.includes(model)) throw httpError(404, "model not found");
        if (broken.includes(model)) throw httpError(500, "boom");
        return {
          choices: [{ message: { content: '{"items":[]}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        } as unknown as ChatApiResponse;
      },
    };
  }

  const make = (chat: ChatApi, env: Record<string, string>) =>
    createWriterLlm({
      root,
      env: loadEnv(env),
      api: chat,
      budget: new TokenBudget(1_000_000),
      log: captureLog().log,
      retry: { sleep: async () => {} },
    });

  it("uses the Settings model first", async () => {
    await writeFile(
      join(root, "config/writer.json"),
      '{"version":1,"provider":"nebius","model":"picked/model"}\n',
    );
    const chat = api([]);
    const llm = make(chat, { DISPATCH_MODEL: "env-a" });
    expect(llm.model).toBe("picked/model");
    await llm.completeJson(request());
    expect(chat.used[0]).toBe("picked/model");
  });

  it("falls through to the environment model when the pick is retired or fails", async () => {
    await writeFile(
      join(root, "config/writer.json"),
      '{"version":1,"provider":"nebius","model":"picked/model"}\n',
    );
    for (const chat of [api(["picked/model"]), api([], ["picked/model"])]) {
      const llm = make(chat, { DISPATCH_MODEL: "env-a" });
      await llm.completeJson(request());
      expect(llm.model).toBe("env-a");
    }
  });

  it("writes with Claude Sonnet without a usable file, and with the environment without its key", async () => {
    const key = { ANTHROPIC_API_KEY: "an-secret-777777777777" };
    expect(make(api([]), { DISPATCH_MODEL: "env-a", ...key }).model).toBe("claude-sonnet-5-5");
    await writeFile(join(root, "config/writer.json"), "{ not json");
    expect(make(api([]), { DISPATCH_MODEL: "env-a", ...key }).model).toBe("claude-sonnet-5-5");
    // A run without the key is never stopped by the default: the Nebius models write.
    expect(make(api([]), { DISPATCH_MODEL: "env-a" }).model).toBe("env-a");
  });

  it("still reports a missing model when all three are empty", () => {
    expect(() => make(api([]), {})).toThrow("DISPATCH_MODEL is not set");
  });
});
