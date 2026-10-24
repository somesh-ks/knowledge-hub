import { hostNamesFor } from "@singularity/core/hosts";
import { describe, expect, it } from "vitest";
import {
  hostOf,
  LEGACY_HOSTS,
  needsVoiceList,
  readHostNames,
  readVoiceIds,
  transcriptNames,
} from "./hosts";

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

  it("keeps the old pair only when the script itself says it", () => {
    const says = [
      { speaker: "a", text: "I'm Ada." },
      { speaker: "b", text: "And I'm Leo." },
    ];
    expect(transcriptNames(says)).toBe(LEGACY_HOSTS);
    expect(transcriptNames(says, null, null)).toBe(LEGACY_HOSTS);
    // A word that only contains the name is not the name.
    const near = [{ speaker: "a", text: "Adaptive layouts" }, guest];
    expect(transcriptNames(near, null, null)).toEqual(hostNamesFor(null, null));
  });

  it("names nobody while the voice list is on its way, and never Ada and Leo", () => {
    expect(transcriptNames([lead, guest])).toBeNull();
    expect(transcriptNames([lead, guest], null)).toBeNull();
    expect(needsVoiceList([lead, guest])).toBe(true);
    expect(needsVoiceList([lead, guest], { a: "Maya", b: "Theo" })).toBe(false);
    expect(needsVoiceList([lead, lead])).toBe(false);
  });

  it("gives a neutral pair when the voice list cannot be read", () => {
    expect(transcriptNames([lead, guest], null, null)).toEqual({ a: "Alex", b: "Sam" });
  });

  const list = [
    { id: "v-dan", name: "Dan", gender: "male" },
    { id: "v-sophia", name: "Sophia", gender: "female" },
    { id: "v-geffen_32", name: "geffen_32", gender: "male" },
  ];

  it("names the hosts after the voices the episode asked for", () => {
    const names = transcriptNames([lead, guest], null, {
      ids: { a: "v-dan", b: "v-sophia" },
      list,
      defaults: { voice: "v-sophia", voice_b: "v-dan" },
    });
    expect(names).toEqual({ a: "Dan", b: "Sophia" });
  });

  it("uses the voices Default stands for when the episode stored none", () => {
    const lookup = {
      ids: { a: null, b: null },
      list,
      defaults: { voice: "v-geffen_32", voice_b: "v-sophia" },
    };
    expect(transcriptNames([lead, guest], null, lookup)).toEqual(
      hostNamesFor(list[2] ?? null, list[1] ?? null),
    );
    expect(transcriptNames([lead, guest], null, { ...lookup, ids: null })).toEqual(
      transcriptNames([lead, guest], null, lookup),
    );
  });

  it("gives a neutral pair for a voice the list does not hold, as the engine does", () => {
    const names = transcriptNames([lead, guest], null, {
      ids: { a: "v-gone", b: "v-dan" },
      list,
      defaults: null,
    });
    expect(names).toEqual(hostNamesFor(null, null));
  });

  it("lets stored names win over the voices", () => {
    const names = transcriptNames([lead, guest], { a: "Maya", b: "Theo" }, null);
    expect(names).toEqual({ a: "Maya", b: "Theo" });
  });
});

describe("readVoiceIds", () => {
  it("reads two ids, a missing one as the default", () => {
    expect(readVoiceIds({ a: "v1", b: null })).toEqual({ a: "v1", b: null });
    expect(readVoiceIds({ a: "", b: 3 })).toEqual({ a: null, b: null });
    expect(readVoiceIds(undefined)).toBeNull();
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
