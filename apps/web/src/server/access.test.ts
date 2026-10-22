import { hashPassphrase } from "@dispatch/core/passphrase";
import { describe, expect, it } from "vitest";
import { OPEN_PASSPHRASE } from "../lib/access";
import { createGuessGate, passphraseCheck, refusePassphrase } from "./access";

describe("passphraseCheck", () => {
  it("compares against the stored hash when the passphrase is required", async () => {
    const hash = await hashPassphrase("correct horse battery staple");
    const check = passphraseCheck(true);
    expect(await check("correct horse battery staple", hash)).toBe(true);
    expect(await check("something else", hash)).toBe(false);
    expect(await check(OPEN_PASSPHRASE, hash)).toBe(false);
  });

  it("lets any value through when the passphrase step is off", async () => {
    const hash = await hashPassphrase("correct horse battery staple");
    const check = passphraseCheck(false);
    expect(await check(OPEN_PASSPHRASE, hash)).toBe(true);
    expect(await check("something else", hash)).toBe(true);
  });
});

describe("refusePassphrase", () => {
  // Bug it prevents: past the cap a guess was still checked, so a flood cost scrypt work on every
  // request, and it was answered 401, which makes a page forget the owner's remembered passphrase.
  it("past the cap of wrong guesses answers 429 without checking, and a right one never counts", async () => {
    let now = Date.parse("2026-10-22T12:00:10Z");
    const counts = new Map<string, number>();
    const limit = async (bucket: string, perMinute: number) => {
      const count = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, count);
      return count <= perMinute;
    };
    let checks = 0;
    const deps = {
      verifyPassphrase: async (passphrase: string) => {
        checks += 1;
        return passphrase === "right";
      },
      delay: async () => {},
      guesses: createGuessGate(limit, 2, () => now),
    };

    expect(await refusePassphrase("right", "hash", deps)).toBeNull();
    for (let guess = 0; guess < 3; guess += 1) {
      expect((await refusePassphrase("wrong", "hash", deps))?.status).toBe(401);
    }
    const closed = await refusePassphrase("right", "hash", deps);
    expect(closed?.status).toBe(429);
    expect(closed?.body).toMatchObject({ error: "cooldown", retry_after_s: 50 });
    expect(checks).toBe(4);
    expect(counts.get("passphrase-fail")).toBe(3);

    now += 50_000;
    expect(await refusePassphrase("right", "hash", deps)).toBeNull();
  });
});
