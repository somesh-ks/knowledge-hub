import type { StructureFile } from "@singularity/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeConfigCommand } from "../src/commands/config.js";
import { type ConfigRepo, configRepo } from "./topics-helpers.js";

let repo: ConfigRepo;

beforeEach(async () => {
  repo = await configRepo(new Date("2026-10-24T06:00:00Z"));
  vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await repo.cleanup();
});

async function apply(op: unknown): Promise<number> {
  return makeConfigCommand()(["apply", "--op", JSON.stringify(op)], repo.context());
}

it("a topic made after the structure was saved still plays in the stored kind, and a kind on its defaults stays off the file", async () => {
  const daily = [{ type: "hello" }, { type: "top_picks" }, { type: "sign_off" }];
  expect(await apply({ op: "structure.set", kind: "daily", blocks: daily })).toBe(0);
  const quantum = {
    name: "Quantum computing",
    description: "Hardware, algorithms and error correction.",
    keywords: ["qubit"],
  };
  expect(await apply({ op: "topic.upsert", topic: quantum })).toBe(0);
  const file = await repo.readJson<StructureFile>("config/structure.json");
  expect(
    file.kinds.daily?.map((block) => (block.type === "section" ? block.id : block.type)),
  ).toEqual(["hello", "top_picks", "quantum_computing", "sign_off"]);
  expect(file.kinds.weekly).toBeUndefined();
  // Removing its last topic takes the section out again.
  expect(await apply({ op: "topic.remove", id: "quantum_computing" })).toBe(0);
  const after = await repo.readJson<StructureFile>("config/structure.json");
  expect(after.kinds.daily?.map((block) => block.type)).toEqual(["hello", "top_picks", "sign_off"]);
});

it("putting a general topic into a stored kind adds the section its stories are filed under, not the shared general one", async () => {
  const daily = [{ type: "hello" }, { type: "top_picks" }, { type: "sign_off" }];
  expect(await apply({ op: "structure.set", kind: "daily", blocks: daily })).toBe(0);
  expect(await apply({ op: "topic.scope", ids: ["world", "trending"], daily: true })).toBe(0);
  const file = await repo.readJson<StructureFile>("config/structure.json");
  expect(
    file.kinds.daily?.map((block) => (block.type === "section" ? block.id : block.type)),
  ).toEqual(["hello", "top_picks", "world", "sign_off"]);
});

it("a block's own prompt survives a reorder of its kind, and putting back the built-in one removes it (D182)", async () => {
  const prompt = "Write each design story as one plain sentence on what changed for a designer.";
  expect(
    await apply({ op: "structure.prompt", kind: "daily", key: "section:design", prompt }),
  ).toBe(0);
  const daily = [
    { type: "hello" },
    { type: "section", id: "design" },
    { type: "top_picks" },
    { type: "sign_off" },
  ];
  expect(await apply({ op: "structure.set", kind: "daily", blocks: daily })).toBe(0);
  const file = await repo.readJson<StructureFile>("config/structure.json");
  expect(file.prompts?.daily?.["section:design"]).toBe(prompt);
  // Code speaks a daily hello, so it takes no prompt.
  expect(
    await apply({ op: "structure.prompt", kind: "daily", key: "hello", prompt: "Say hi." }),
  ).not.toBe(0);
  expect(
    await apply({ op: "structure.prompt", kind: "daily", key: "section:design", prompt: null }),
  ).toBe(0);
  const after = await repo.readJson<StructureFile>("config/structure.json");
  expect(after.prompts).toBeUndefined();
  expect(after.kinds.daily).toHaveLength(4);
});
