import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANTHROPIC_MODELS, MODEL_ID_PATTERN } from "@dispatch/core";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_MODELS, contextLabel, isModelId, modelParts } from "./modelId";
import { loadWriterView, writerLabel } from "./writer";

describe("modelId", () => {
  it("keeps the browser pattern identical to core's", () => {
    expect(MODEL_ID_PATTERN.source).toBe(/^[A-Za-z0-9._\-/:]{1,120}$/.source);
    for (const id of ["a", "meta-llama/Llama-3.3-70B-Instruct", "x:y_z.1", "a b", "", "é"]) {
      expect(isModelId(id), id).toBe(MODEL_ID_PATTERN.test(id));
    }
  });

  it("keeps the Claude list identical to core's", () => {
    expect(CLAUDE_MODELS).toEqual(ANTHROPIC_MODELS.map((entry) => ({ ...entry })));
  });

  it("splits the vendor from the name", () => {
    expect(modelParts("meta-llama/Llama-3.3-70B-Instruct")).toEqual({
      vendor: "meta-llama",
      name: "Llama-3.3-70B-Instruct",
    });
    expect(modelParts("plain")).toEqual({ vendor: "", name: "plain" });
    expect(modelParts("a/b/c")).toEqual({ vendor: "a/b", name: "c" });
  });

  it("words the context window", () => {
    expect(contextLabel(131072)).toBe("128k context");
    expect(contextLabel(163840)).toBe("160k context");
    expect(contextLabel(512)).toBe("512 tokens context");
    expect(contextLabel(null)).toBe("");
    expect(contextLabel(0)).toBe("");
  });
});

describe("loadWriterView", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function repo(writer?: string): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "writer-"));
    if (writer !== undefined) {
      await mkdir(join(dir, "config"), { recursive: true });
      await writeFile(join(dir, "config", "writer.json"), writer);
    }
    return dir;
  }

  it("is Automatic without a file", async () => {
    const root = await repo();
    expect(await loadWriterView({ root, env: {} })).toEqual({
      provider: "nebius",
      model: null,
      label: "Automatic",
    });
  });

  it("reads the saved model and labels it by its last segment", async () => {
    const root = await repo('{"version":1,"provider":"nebius","model":"meta-llama/Llama-3.3-70B"}');
    expect(await loadWriterView({ root, env: {} })).toEqual({
      provider: "nebius",
      model: "meta-llama/Llama-3.3-70B",
      label: "Llama-3.3-70B",
    });
  });

  it("falls back to Automatic for a file that is not valid", async () => {
    for (const text of ["{ not json", '{"version":1,"provider":"other","model":null}']) {
      const root = await repo(text);
      expect((await loadWriterView({ root, env: {} })).model).toBeNull();
      await rm(root, { recursive: true, force: true });
      dir = "";
    }
  });

  it("labels", () => {
    expect(writerLabel(null)).toBe("Automatic");
    expect(writerLabel("a/b")).toBe("b");
    expect(writerLabel("claude-sonnet-5-5", "anthropic")).toBe("Claude Sonnet 5.5");
  });
});
