import { describe, expect, it } from "vitest";
import {
  ConfigOp,
  DEFAULT_WRITER,
  isTextModel,
  listModels,
  MODEL_ID_PATTERN,
  resolveWriterModels,
  WriterFile,
  WriterSettings,
} from "./index.js";

describe("Anthropic provider", () => {
  it("accepts the two listed models and nothing else", () => {
    for (const id of ["claude-sonnet-5-5", "claude-haiku-5-5"]) {
      expect(WriterFile.safeParse({ version: 1, provider: "anthropic", model: id }).success).toBe(
        true,
      );
      expect(
        ConfigOp.safeParse({ op: "writer.set", provider: "anthropic", model: id }).success,
      ).toBe(true);
    }
    for (const model of ["claude-opus-9", "Qwen/Qwen3-235B", "claude-", null]) {
      expect(
        WriterSettings.safeParse({ provider: "anthropic", model }).success,
        String(model),
      ).toBe(false);
      expect(ConfigOp.safeParse({ op: "writer.set", provider: "anthropic", model }).success).toBe(
        false,
      );
    }
  });

  it("refuses a claude id on Nebius", () => {
    expect(
      WriterSettings.safeParse({ provider: "nebius", model: "claude-sonnet-5-5" }).success,
    ).toBe(false);
    expect(WriterSettings.safeParse({ provider: "nebius", model: "Qwen/Qwen3-235B" }).success).toBe(
      true,
    );
  });
});

describe("WriterFile", () => {
  it("accepts the default and a chosen model", () => {
    expect(WriterFile.parse(DEFAULT_WRITER)).toEqual(DEFAULT_WRITER);
    expect(
      WriterFile.safeParse({ version: 1, provider: "nebius", model: "Qwen/Qwen3-235B:fast" })
        .success,
    ).toBe(true);
  });

  it("refuses an unknown provider, an odd id and an empty or oversized id", () => {
    for (const bad of [
      { version: 1, provider: "other", model: null },
      { version: 1, provider: "nebius", model: "has space" },
      { version: 1, provider: "nebius", model: "" },
      { version: 1, provider: "nebius", model: "a".repeat(121) },
      { version: 2, provider: "nebius", model: null },
    ]) {
      expect(WriterFile.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("shares one id pattern with the site", () => {
    expect(MODEL_ID_PATTERN.test("meta-llama/Llama-3.3-70B-Instruct")).toBe(true);
    expect(MODEL_ID_PATTERN.test("bad id")).toBe(false);
    expect(WriterSettings.safeParse({ provider: "nebius", model: null }).success).toBe(true);
  });
});

describe("resolveWriterModels", () => {
  const env = { DISPATCH_MODEL: "env-a", DISPATCH_FALLBACK_MODEL: "env-b" };

  it("orders the Settings model, then the environment models", () => {
    expect(resolveWriterModels("pick", env)).toEqual(["pick", "env-a", "env-b"]);
  });

  it("drops empty values and duplicates", () => {
    expect(resolveWriterModels(null, env)).toEqual(["env-a", "env-b"]);
    expect(resolveWriterModels("env-a", env)).toEqual(["env-a", "env-b"]);
    expect(
      resolveWriterModels("", { DISPATCH_MODEL: "env-a", DISPATCH_FALLBACK_MODEL: "env-a" }),
    ).toEqual(["env-a"]);
  });

  it("is empty when nothing is set", () => {
    expect(resolveWriterModels(null, {})).toEqual([]);
  });
});

describe("models", () => {
  it("filters out non-text models and sorts by id", () => {
    const rows = listModels(
      {
        data: [
          { id: "z/chat", max_model_len: 32000 },
          { id: "a/chat", context_length: 128000 },
          { id: "BAAI/bge-en-icl" },
          { id: "x/draw", type: "text2image" },
        ],
      },
      false,
    );
    expect(rows).toEqual([
      { id: "a/chat", context_length: 128000 },
      { id: "z/chat", context_length: 32000 },
    ]);
    expect(isTextModel({ id: "m", type: "embedding" })).toBe(false);
  });
});
