import { describe, expect, it } from "vitest";
import { hostOf, LEGACY_HOSTS, readHostNames, transcriptNames } from "./hosts";

const lead = { speaker: "a" };
const guest = { speaker: "b" };

describe("transcriptNames", () => {
  it("names nobody in an episode with one voice", () => {
    expect(transcriptNames([lead, lead])).toBeNull();
    expect(transcriptNames([lead, lead], { a: "Maya", b: "Theo" })).toBeNull();
    expect(transcriptNames([])).toBeNull();
  });

  it("shows the stored pair when a discussion has one", () => {
    expect(transcriptNames([lead, guest], { a: "Maya", b: "Theo" })).toEqual({
      a: "Maya",
      b: "Theo",
    });
  });

  it("falls back to the pair an older discussion was written for", () => {
    expect(transcriptNames([lead, guest])).toBe(LEGACY_HOSTS);
    expect(transcriptNames([lead, guest], null)).toBe(LEGACY_HOSTS);
  });
});

describe("readHostNames", () => {
  it("reads a stored pair and trims it", () => {
    expect(readHostNames({ a: " Maya ", b: "Theo" })).toEqual({ a: "Maya", b: "Theo" });
  });

  it("ignores anything that is not a pair of names", () => {
    for (const value of [
      undefined,
      null,
      "Maya",
      { a: "Maya" },
      { a: "", b: "Theo" },
      { a: 1, b: 2 },
    ])
      expect(readHostNames(value)).toBeNull();
  });
});

describe("hostOf", () => {
  const names = { a: "Maya", b: "Theo" };

  it("names the speaker from the pair and tells the two apart by tone", () => {
    expect(hostOf("a", names)).toEqual({ key: "a", name: "Maya", tone: "lead" });
    expect(hostOf("b", names)).toEqual({ key: "b", name: "Theo", tone: "guest" });
  });

  it("has no name without a pair", () => {
    expect(hostOf("a", null).name).toBeNull();
  });

  it("gives an unknown speaker to the lead", () => {
    expect(hostOf("x", names).key).toBe("a");
  });
});
