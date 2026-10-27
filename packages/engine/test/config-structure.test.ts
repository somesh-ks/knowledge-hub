import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

const names = (file: StructureFile): string[] =>
  (file.blocks ?? []).map((block) => (block.type === "section" ? block.id : block.type));

const SHORT = [{ type: "hello" }, { type: "top_picks" }, { type: "sign_off" }];

it("a topic made after the structure was saved still plays in it, and removing its last topic takes the section out again", async () => {
  expect(await apply({ op: "structure.set", profile: "custom", blocks: SHORT })).toBe(0);
  const quantum = {
    name: "Quantum computing",
    description: "Hardware, algorithms and error correction.",
    keywords: ["qubit"],
  };
  expect(await apply({ op: "topic.upsert", topic: quantum })).toBe(0);
  const file = await repo.readJson<StructureFile>("config/structure.json");
  expect(file.profile).toBe("custom");
  expect(names(file)).toEqual(["hello", "top_picks", "quantum_computing", "sign_off"]);
  expect(await apply({ op: "topic.remove", id: "quantum_computing" })).toBe(0);
  expect(names(await repo.readJson<StructureFile>("config/structure.json"))).toEqual([
    "hello",
    "top_picks",
    "sign_off",
  ]);
});

it("putting a general topic into the structure adds the section its stories are filed under, not the shared general one", async () => {
  expect(await apply({ op: "structure.set", profile: "custom", blocks: SHORT })).toBe(0);
  expect(await apply({ op: "topic.scope", ids: ["world", "trending"], daily: true })).toBe(0);
  expect(names(await repo.readJson<StructureFile>("config/structure.json"))).toEqual([
    "hello",
    "top_picks",
    "world",
    "sign_off",
  ]);
});

it("choosing a named profile keeps the owner's own list aside, and choosing Custom again runs it and keeps none apart", async () => {
  expect(await apply({ op: "structure.set", profile: "custom", blocks: SHORT })).toBe(0);
  expect(await apply({ op: "structure.set", profile: "designer" })).toBe(0);
  expect(await apply({ op: "structure.set", profile: "student" })).toBe(0);
  const student = await repo.readJson<StructureFile>("config/structure.json");
  expect(names({ ...student, blocks: student.custom_blocks })).toEqual([
    "hello",
    "top_picks",
    "sign_off",
  ]);
  expect(await apply({ op: "structure.set", profile: "custom", blocks: SHORT })).toBe(0);
  const back = await repo.readJson<StructureFile>("config/structure.json");
  expect(names(back)).toEqual(["hello", "top_picks", "sign_off"]);
  expect(back.custom_blocks).toBeUndefined();
});

it("a named profile is saved by its id with the preset's blocks, and a file saved per podcast kind is read as Custom and rewritten in the new shape by the next save", async () => {
  expect(await apply({ op: "structure.set", profile: "designer" })).toBe(0);
  const designer = await repo.readJson<StructureFile>("config/structure.json");
  expect(designer.profile).toBe("designer");
  expect(names(designer)).toContain("ui-craft");

  await mkdir(join(repo.root, "config"), { recursive: true });
  const old = {
    version: 1,
    kinds: {
      weekly: [...SHORT],
      daily: [{ type: "hello" }, { type: "trending" }, { type: "sign_off" }],
    },
    prompts: { daily: { trending: "Name the outlet first." } },
  };
  await writeFile(join(repo.root, "config/structure.json"), JSON.stringify(old), "utf8");
  expect(
    await apply({ op: "structure.prompt", key: "section:design", prompt: "One plain line." }),
  ).toBe(0);
  const migrated = await repo.readJson<StructureFile & { kinds?: unknown }>(
    "config/structure.json",
  );
  expect(migrated.kinds).toBeUndefined();
  expect(migrated.profile).toBe("custom");
  expect(names(migrated)).toEqual(["hello", "trending", "sign_off"]);
  expect(migrated.prompts).toEqual({
    trending: "Name the outlet first.",
    "section:design": "One plain line.",
  });
});

it("a block's own prompt survives a change of the blocks, and putting back the built-in one removes it (D182)", async () => {
  const prompt = "Write each design story as one plain sentence on what changed for a designer.";
  expect(await apply({ op: "structure.prompt", key: "section:design", prompt })).toBe(0);
  const blocks = [
    { type: "hello" },
    { type: "section", id: "design" },
    { type: "top_picks" },
    { type: "sign_off" },
  ];
  expect(await apply({ op: "structure.set", profile: "custom", blocks })).toBe(0);
  const file = await repo.readJson<StructureFile>("config/structure.json");
  expect(file.prompts?.["section:design"]).toBe(prompt);
  expect(await apply({ op: "structure.prompt", key: "section:design", prompt: null })).toBe(0);
  const after = await repo.readJson<StructureFile>("config/structure.json");
  expect(after.prompts).toBeUndefined();
  expect(after.blocks).toHaveLength(4);
});
