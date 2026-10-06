import { describe, expect, it } from "vitest";
import { readServerConfig, secretsOf } from "./config";

const GOOD = {
  GITHUB_DISPATCH_TOKEN: "github_pat_example",
  GITHUB_REPOSITORY: "somesh-ks/dispatch",
  GENERATE_PASSPHRASE_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
};

describe("readServerConfig", () => {
  it("reads a complete environment", () => {
    expect(readServerConfig(GOOD)).toEqual({
      token: "github_pat_example",
      owner: "somesh-ks",
      repo: "dispatch",
      repository: "somesh-ks/dispatch",
      passphraseHash: GOOD.GENERATE_PASSPHRASE_HASH,
    });
  });

  it("is null when any variable is missing or blank", () => {
    for (const key of Object.keys(GOOD)) {
      expect(readServerConfig({ ...GOOD, [key]: undefined })).toBeNull();
      expect(readServerConfig({ ...GOOD, [key]: "  " })).toBeNull();
    }
  });

  it("rejects a repository that is not owner/name", () => {
    for (const bad of ["dispatch", "a/b/c", "../etc/passwd", "owner/"]) {
      expect(readServerConfig({ ...GOOD, GITHUB_REPOSITORY: bad })).toBeNull();
    }
  });

  it("trims stray whitespace from pasted values", () => {
    expect(
      readServerConfig({ ...GOOD, GITHUB_DISPATCH_TOKEN: " github_pat_example\n" })?.token,
    ).toBe("github_pat_example");
  });
});

describe("secretsOf", () => {
  it("lists the token and the hash for the log redactor", () => {
    const config = readServerConfig(GOOD);
    expect(secretsOf(config)).toEqual([GOOD.GITHUB_DISPATCH_TOKEN, GOOD.GENERATE_PASSPHRASE_HASH]);
    expect(secretsOf(null)).toEqual([]);
  });
});
