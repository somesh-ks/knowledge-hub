import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../src/context.js";
import type { JsonRequest, JsonResult, LlmClient } from "../src/llm/types.js";
import { createLinter, type Linter } from "../src/voice/lint.js";
import { parseVoice, type VoiceConfig } from "../src/voice/voice.js";
import { FIXTURE_CONFIG } from "./score-factories.js";

export type FakeHandler = (
  request: JsonRequest<unknown>,
  call: number,
) => unknown | Promise<unknown>;

/**
 * A scripted LlmClient. The handler returns the raw reply; the schema in the request validates
 * it, so a bad reply fails exactly as it would against the real client.
 */
export class FakeLlm implements LlmClient {
  readonly model: string;
  readonly calls: JsonRequest<unknown>[] = [];
  private readonly handler: FakeHandler;

  constructor(handler: FakeHandler, model = "test-model") {
    this.handler = handler;
    this.model = model;
  }

  async completeJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    this.calls.push(request as JsonRequest<unknown>);
    const raw = await this.handler(request as JsonRequest<unknown>, this.calls.length - 1);
    const value = request.schema.parse(raw);
    return { value, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } };
  }

  /** Text of the user message of a call, where the delimited source material sits. */
  userText(call: number): string {
    const request = this.calls[call];
    return (request?.messages ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
  }

  systemText(call: number): string {
    const request = this.calls[call];
    return (request?.messages ?? [])
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
  }
}

export interface CapturedLog {
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

/** A Logger that records calls instead of printing. */
export function captureLog(): { log: Logger; lines: CapturedLog[] } {
  const lines: CapturedLog[] = [];
  const push = (level: string) => (message: string, data?: Record<string, unknown>) => {
    lines.push({ level, message, ...(data ? { data } : {}) });
  };
  return {
    lines,
    log: { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") },
  };
}

/** An error shaped like the SDK errors: a numeric `status` and optional headers. */
export function httpError(
  status: number,
  message = "failed",
  headers?: Record<string, string>,
): Error {
  return Object.assign(new Error(message), { status, ...(headers ? { headers } : {}) });
}

/** Retry options that never wait. */
export const NO_WAIT = { sleep: async () => {}, random: () => 0 };

/** The real config/voice.md, parsed once. */
export function testVoice(): VoiceConfig {
  return parseVoice(readFileSync(join(FIXTURE_CONFIG, "voice.md"), "utf8"));
}

export function testLinter(): Linter {
  return createLinter(testVoice());
}
