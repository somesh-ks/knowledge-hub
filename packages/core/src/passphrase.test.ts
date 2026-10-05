import { describe, expect, it } from "vitest";
import { hashPassphrase, verifyPassphrase } from "./passphrase.js";

describe("passphrase", () => {
  it("verifies the right passphrase and rejects a wrong one", async () => {
    const stored = await hashPassphrase("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassphrase("correct horse battery", stored)).toBe(true);
    expect(await verifyPassphrase("correct horse batterz", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    const a = await hashPassphrase("same passphrase");
    const b = await hashPassphrase("same passphrase");
    expect(a).not.toBe(b);
  });

  it("returns false for malformed or oversized stored values", async () => {
    expect(await verifyPassphrase("x", "")).toBe(false);
    expect(await verifyPassphrase("x", "scrypt$1$1$1$a$b")).toBe(false);
    expect(await verifyPassphrase("x", "scrypt$999999999$8$1$AAAA$AAAA")).toBe(false);
  });

  it("rejects short passphrases when hashing", async () => {
    await expect(hashPassphrase("short")).rejects.toThrow();
  });
});
