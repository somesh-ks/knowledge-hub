import { describe, expect, it } from "vitest";
import { HOST_NAME_POOLS, type HostVoice, hostGender, hostNamesFor } from "./hosts.js";
import { HostName } from "./podcast.js";

const IDS = Array.from({ length: 200 }, (_, index) => `voice_${index}`);

describe("hostGender", () => {
  it.each([
    ["female", "female"],
    ["Female", "female"],
    [" F ", "female"],
    ["woman", "female"],
    ["WOMAN", "female"],
    ["male", "male"],
    ["MALE", "male"],
    ["m", "male"],
    ["Man", "male"],
    ["neutral", "neutral"],
    ["nonbinary", "neutral"],
    ["females", "neutral"],
    ["", "neutral"],
    [null, "neutral"],
    [undefined, "neutral"],
  ] as const)("reads %j as %s", (given, expected) => {
    expect(hostGender(given)).toBe(expected);
  });
});

describe("the name pools", () => {
  it("hold at least eight short given names each, and no name is in two pools", () => {
    const all = Object.values(HOST_NAME_POOLS).flat();
    for (const pool of Object.values(HOST_NAME_POOLS)) {
      expect(pool.length).toBeGreaterThanOrEqual(8);
      for (const name of pool) expect(name).toMatch(/^[A-Z][a-z]{1,6}$/);
    }
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("hostNamesFor", () => {
  it("gives a gender-neutral pair for null or unknown voices", () => {
    expect(hostNamesFor(null, null)).toEqual({ a: "Alex", b: "Sam" });
    expect(hostNamesFor({ id: null }, { id: null, name: null, gender: "" })).toEqual({
      a: "Alex",
      b: "Sam",
    });
    for (const id of IDS) {
      const names = hostNamesFor({ id, gender: "unknown" }, { id: `${id}-b` });
      expect(HOST_NAME_POOLS.neutral).toContain(names.a);
      expect(HOST_NAME_POOLS.neutral).toContain(names.b);
    }
  });

  it("follows each voice's gender, whichever host it reads", () => {
    for (const id of IDS) {
      const names = hostNamesFor({ id, gender: "male" }, { id: `${id}-b`, gender: "female" });
      expect(HOST_NAME_POOLS.male).toContain(names.a);
      expect(HOST_NAME_POOLS.female).toContain(names.b);
      const swapped = hostNamesFor({ id, gender: "Female" }, { id: `${id}-b`, gender: "M" });
      expect(HOST_NAME_POOLS.female).toContain(swapped.a);
      expect(HOST_NAME_POOLS.male).toContain(swapped.b);
    }
  });

  it("keeps a voice's name whichever host it reads and whoever reads beside it", () => {
    for (const id of IDS) {
      const voice = { id, gender: "female" };
      const name = hostNamesFor(voice, null).a;
      expect(hostNamesFor({ id: "other", gender: "male" }, voice).b).toBe(name);
      expect(hostNamesFor(voice, { id: "z", gender: "male" }).a).toBe(name);
      expect(hostNamesFor(voice, null)).toEqual(hostNamesFor(voice, null));
    }
  });

  it("picks the same names it always has, so a voice is never renamed by accident", () => {
    expect(
      hostNamesFor({ id: "geffen_32", gender: "male" }, { id: "dominic_32", gender: "male" }),
    ).toEqual({ a: "Paul", b: "Felix" });
    expect(
      hostNamesFor({ id: "voice-3", gender: "female" }, { id: "x3", gender: "neutral" }),
    ).toEqual({ a: "Helen", b: "Quinn" });
  });

  it("gives each host a fixed default without a voice id: Ada and Leo for a woman and a man", () => {
    expect(hostNamesFor({ id: null, gender: "female" }, { id: null, gender: "male" })).toEqual({
      a: "Ada",
      b: "Leo",
    });
    expect(hostNamesFor({ id: null, gender: "male" }, { id: null, gender: "female" })).toEqual({
      a: "Owen",
      b: "Nora",
    });
    expect(hostNamesFor({ id: null, gender: "male" }, { id: null, gender: "male" })).toEqual({
      a: "Owen",
      b: "Leo",
    });
  });

  it("uses the voice's own name when it is one given name", () => {
    const named = (name: string, gender = "male"): HostVoice => ({
      id: `id-${name}`,
      name,
      gender,
    });
    expect(hostNamesFor(named("Geffen"), named("dominic"))).toEqual({ a: "Geffen", b: "Dominic" });
    expect(hostNamesFor(named("zoë", "female"), named("Mary-Jane", "female"))).toEqual({
      a: "Zoë",
      b: "Mary-Jane",
    });
    expect(hostNamesFor(named("O’Neil"), named("d'Arcy"))).toEqual({ a: "O’Neil", b: "D'Arcy" });
    expect(hostNamesFor(named("  Nora ", "female"), null).a).toBe("Nora");
    expect(hostNamesFor(named("élodie", "female"), null).a).toBe("Élodie");
    // A name typed with a combining mark reads as the same letters.
    expect(hostNamesFor(named("Zoë", "female"), null).a).toBe("Zoë");
    expect(hostNamesFor(named("Al"), null).a).toBe("Al");
    expect(hostNamesFor(named("Christophersen"), null).a).toBe("Christophersen");
    // A voice whose gender is unknown keeps its own name: that assumes nothing.
    expect(hostNamesFor({ id: "x", name: "Robin" }, null).a).toBe("Robin");
  });

  it("falls back to the pool for its gender when the name is not one given name", () => {
    for (const name of [
      "Narrator Dan",
      "Snoop Dogg",
      "geffen_32",
      "R2D2",
      "A",
      "Christophersson",
      "-Ann",
      "Ann-",
      "Ann--Marie",
      "Dr. Who",
      "",
      "   ",
    ]) {
      expect(hostNamesFor({ id: "voice-3", name, gender: "male" }, null).a, name).toBe("Mark");
    }
    expect(hostNamesFor({ id: "voice-3", name: "Narrator Dan" }, null).a).toBe("Morgan");
  });

  it("gives the second host the next name in its pool when the two would match", () => {
    // One voice reading both hosts.
    expect(
      hostNamesFor({ id: "voice-x", gender: "female" }, { id: "voice-x", gender: "female" }),
    ).toEqual({ a: "Ivy", b: "June" });
    const archie = { id: "archie", name: "Archie", gender: "male" };
    expect(hostNamesFor(archie, archie)).toEqual({ a: "Archie", b: "Felix" });
    // Two voices with one display name, whatever its case.
    const nora = hostNamesFor(
      { id: "n1", name: "Nora", gender: "female" },
      { id: "n2", name: "NORA", gender: "female" },
    );
    expect(nora.a).toBe("Nora");
    expect(HOST_NAME_POOLS.female).toContain(nora.b);
    expect(nora.b).not.toBe("Nora");
    for (const gender of ["female", "male", ""]) {
      const pool = HOST_NAME_POOLS[hostGender(gender)];
      for (const id of IDS) {
        const names = hostNamesFor({ id, gender }, { id, gender });
        expect(names.b).toBe(pool[(pool.indexOf(names.a) + 1) % pool.length]);
      }
    }
  });

  it("only ever makes names a request accepts", () => {
    const names = ["Nora", "Narrator Dan", "zoë", "Mary-Jane", "O’Neil", "R2D2", "", "ß"];
    const genders = ["female", "male", "", "F", "other"];
    IDS.forEach((id, index) => {
      const voice = (slot: number): HostVoice => ({
        id: index % 7 === 0 ? null : `${id}-${slot}`,
        name: names[(index + slot) % names.length] ?? null,
        gender: genders[(index + slot) % genders.length] ?? null,
      });
      const pair = hostNamesFor(voice(0), voice(1));
      expect(HostName.safeParse(pair.a).success, pair.a).toBe(true);
      expect(HostName.safeParse(pair.b).success, pair.b).toBe(true);
      expect(pair.a.toLowerCase()).not.toBe(pair.b.toLowerCase());
    });
  });
});
