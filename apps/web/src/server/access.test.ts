import { hashPassphrase } from "@dispatch/core/passphrase";
import { describe, expect, it } from "vitest";
import { OPEN_PASSPHRASE } from "../lib/access";
import { passphraseCheck } from "./access";

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
