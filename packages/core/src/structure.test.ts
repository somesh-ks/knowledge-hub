import { describe, expect, it } from "vitest";
import { defaultStructure, STRUCTURE_KINDS, StructureBlocks, StructureFile } from "./structure.js";

describe("the structure schema refuses a broken episode shape", () => {
  const hello = { type: "hello" };
  const signOff = { type: "sign_off" };
  const design = { type: "section", id: "design" };
  it.each([
    ["the frame out of place", [design, hello, signOff]],
    ["a duplicate section", [hello, design, design, signOff]],
    ["an empty body", [hello, signOff]],
    ["a second rundown", [hello, { type: "rundown" }, { type: "rundown" }, signOff]],
    ["a section a block of its own stands for", [hello, { type: "section", id: "top" }, signOff]],
    [
      "a brief past its limit",
      [hello, { type: "custom", title: "Note", brief: "x".repeat(281) }, signOff],
    ],
  ])("refuses %s", (_name, value) => {
    expect(StructureBlocks.safeParse(value).success).toBe(false);
  });

  it("refuses a close or a block of your own in a daily or weekly kind, which code narrates, and takes them for Catch up", () => {
    const close = [hello, design, { type: "close" }, signOff];
    expect(StructureFile.safeParse({ version: 1, kinds: { daily: close } }).success).toBe(false);
    expect(StructureFile.safeParse({ version: 1, kinds: { catch_up: close } }).success).toBe(true);
  });

  it("accepts every kind's defaults, so an untouched kind always validates", () => {
    for (const kind of STRUCTURE_KINDS) {
      expect(StructureBlocks.safeParse(defaultStructure(kind, ["quantum", "world"])).success).toBe(
        true,
      );
    }
  });
});
