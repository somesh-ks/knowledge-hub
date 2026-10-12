import { randomBytes, scryptSync } from "node:crypto";

/**
 * A stored passphrase hash in the real `scrypt$N$r$p$salt$hash` format, with the cheapest
 * parameters scrypt accepts. The real `verifyPassphrase` reads N, r and p from the stored value,
 * so handler tests keep the real verifier and skip the production cost (N = 2^15, 32 MiB, about
 * a third of a second per check). Real-strength hashing stays tested in `server/access.test.ts`
 * and in core's `passphrase.test.ts`.
 */
export function cheapPassphraseHash(passphrase: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase.normalize("NFKC"), salt, 32, { N: 2, r: 1, p: 1 });
  return ["scrypt", 2, 1, 1, salt.toString("base64"), key.toString("base64")].join("$");
}
