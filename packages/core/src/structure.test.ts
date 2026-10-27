import { describe, expect, it } from "vitest";
import {
  defaultStructure,
  NAMED_PROFILES,
  profileBlocks,
  REFERENCE_MINUTES,
  STRUCTURE_KINDS,
  StructureBlocks,
  StructureFile,
  scaleStructure,
  storedStructure,
  withoutSection,
} from "./structure.js";
import { chooseProfile, editStructure } from "./structureChoice.js";

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

  it("accepts every kind's defaults, so an untouched kind always validates", () => {
    for (const kind of STRUCTURE_KINDS) {
      expect(StructureBlocks.safeParse(defaultStructure(kind, ["quantum", "world"])).success).toBe(
        true,
      );
    }
  });
});

describe("the listener profile", () => {
  const hello = { type: "hello" };
  const signOff = { type: "sign_off" };
  const design = { type: "section", id: "design", max_stories: 2 };
  const trending = { type: "trending" };

  it("reads a file saved per podcast kind as Custom, from the daily list or else the first present, with the kinds' prompts merged", () => {
    const file = StructureFile.parse({
      version: 1,
      kinds: { weekly: [hello, trending, signOff], daily: [hello, design, signOff] },
      prompts: {
        daily: { "section:design": "Plain." },
        catch_up: { hello: "Hi.", "section:design": "No." },
      },
    });
    expect(file.profile).toBe("custom");
    expect(file.blocks).toEqual([hello, { ...design, depth: "brief" }, signOff]);
    expect(file.prompts).toEqual({ hello: "Hi.", "section:design": "Plain." });
    const weeklyOnly = StructureFile.parse({
      version: 1,
      kinds: { weekly: [hello, trending, signOff] },
    });
    expect(weeklyOnly.blocks).toEqual([hello, trending, signOff]);
  });

  it("reads a named profile saved by its id alone as its preset, and every preset is a sound structure", () => {
    const file = StructureFile.parse({ version: 1, profile: "designer" });
    expect(storedStructure(file)).toEqual(profileBlocks("designer"));
    for (const profile of NAMED_PROFILES) {
      expect(StructureBlocks.safeParse(profileBlocks(profile, ["quantum"])).success).toBe(true);
    }
  });

  // A topic removed while Student ran left its section in the kept Custom list, so choosing Custom
  // again ran a section that no longer exists and the editor's resend was refused.
  it("a section removed while a named profile runs leaves the kept Custom list too", () => {
    const kept = StructureBlocks.parse([hello, design, trending, signOff]);
    const file = StructureFile.parse({
      version: 1,
      profile: "student",
      blocks: profileBlocks("student"),
      custom_blocks: kept,
    });
    expect(withoutSection(file, "design").custom_blocks).toEqual([kept[0], kept[2], kept[3]]);
    // A kept list whose only section goes is dropped, so Custom never brings it back.
    const only = { ...file, custom_blocks: StructureBlocks.parse([hello, design, signOff]) };
    expect(withoutSection(only, "design").custom_blocks).toBeUndefined();
  });

  it("Custom, then Student, then Custom again restores the owner's own list, and an edit on Student replaces it only once confirmed", () => {
    const own = StructureBlocks.parse([hello, design, signOff]);
    const student = chooseProfile(
      { profile: "custom", blocks: own },
      "student",
      profileBlocks("student"),
    );
    expect(student.blocks).toEqual(profileBlocks("student"));
    const edited = (student.blocks ?? []).filter((block) => block.type !== "trending");
    expect(editStructure(student, edited, false)).toBeNull();
    expect(
      chooseProfile(
        chooseProfile(student, "designer", profileBlocks("designer")),
        "custom",
        undefined,
      ),
    ).toEqual({
      profile: "custom",
      blocks: own,
    });
    expect(editStructure(student, edited, true)).toEqual({ profile: "custom", blocks: edited });
    expect(editStructure({ profile: "custom", blocks: own }, edited, false)?.blocks).toBe(edited);
  });

  it("sizes every story count to the episode's length, and leaves a block with no count to the engine", () => {
    const blocks = StructureBlocks.parse([
      hello,
      { type: "top_picks", stories: 3 },
      { type: "section", id: "design", max_stories: 4 },
      trending,
      signOff,
    ]);
    const counts = (minutes: number): (number | undefined)[] =>
      scaleStructure(blocks, minutes).map((block) =>
        block.type === "top_picks"
          ? block.stories
          : block.type === "section"
            ? block.max_stories
            : undefined,
      );
    expect(counts(REFERENCE_MINUTES)).toEqual([undefined, 3, 4, undefined, undefined]);
    expect(counts(5)).toEqual([undefined, 2, 2, undefined, undefined]);
    expect(counts(15)).toEqual([undefined, 5, 6, undefined, undefined]);
    expect(scaleStructure(blocks, 3).find((block) => block.type === "trending")).toEqual(trending);
  });
});
