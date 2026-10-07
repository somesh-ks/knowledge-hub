import { describe, expect, it, vi } from "vitest";
import {
  blobSecretsOf,
  narrateSecretsOf,
  readBlobCredentials,
  readNarrateConfig,
  readServerConfig,
  secretsOf,
} from "./config";

const GOOD = {
  GITHUB_DISPATCH_TOKEN: "github_pat_example",
  GITHUB_REPOSITORY: "somesh-ks/knowledge-hub",
  GENERATE_PASSPHRASE_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
};

describe("readServerConfig", () => {
  it("reads a complete environment", () => {
    expect(readServerConfig(GOOD)).toEqual({
      token: "github_pat_example",
      owner: "somesh-ks",
      repo: "knowledge-hub",
      repository: "somesh-ks/knowledge-hub",
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

const BLOB_TOKEN = "vercel_blob_rw_example_0123456789abcdef";
const NARRATE = {
  GENERATE_PASSPHRASE_HASH: GOOD.GENERATE_PASSPHRASE_HASH,
  SPEECHIFY_API_KEY: "speechify-example-key",
  BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
};

describe("readBlobCredentials", () => {
  it("uses the read-write token when it is set, whatever else is", () => {
    const fromRequest = vi.fn(() => "request-oidc-token");
    expect(
      readBlobCredentials(
        { BLOB_READ_WRITE_TOKEN: ` ${BLOB_TOKEN}\n`, BLOB_STORE_ID: "store_abc" },
        fromRequest,
      ),
    ).toEqual({ token: BLOB_TOKEN });
    expect(fromRequest).not.toHaveBeenCalled();
  });

  it("falls back to the store id with the OIDC token from the environment", () => {
    expect(
      readBlobCredentials({ BLOB_STORE_ID: "store_abc", VERCEL_OIDC_TOKEN: "env-oidc-token" }),
    ).toEqual({ oidcToken: "env-oidc-token", storeId: "store_abc" });
  });

  it("reads the OIDC token from the request only when the environment has none", () => {
    const fromRequest = vi.fn(() => "request-oidc-token");
    expect(readBlobCredentials({ BLOB_STORE_ID: "store_abc" }, fromRequest)).toEqual({
      oidcToken: "request-oidc-token",
      storeId: "store_abc",
    });
    expect(
      readBlobCredentials({ BLOB_STORE_ID: "store_abc", VERCEL_OIDC_TOKEN: "env" }, fromRequest),
    ).toEqual({ oidcToken: "env", storeId: "store_abc" });
    expect(fromRequest).toHaveBeenCalledTimes(1);
  });

  it("treats the placeholder `vercel env pull` writes as unset", () => {
    expect(readBlobCredentials({ BLOB_READ_WRITE_TOKEN: "[SENSITIVE]" })).toBeNull();
    expect(
      readBlobCredentials({
        BLOB_READ_WRITE_TOKEN: "[SENSITIVE]",
        BLOB_STORE_ID: "store_abc",
        VERCEL_OIDC_TOKEN: "env-oidc-token",
      }),
    ).toEqual({ oidcToken: "env-oidc-token", storeId: "store_abc" });
  });

  it("is null when nothing usable is configured", () => {
    expect(readBlobCredentials({})).toBeNull();
    expect(readBlobCredentials({ BLOB_READ_WRITE_TOKEN: "  " })).toBeNull();
    expect(readBlobCredentials({ BLOB_STORE_ID: "store_abc" })).toBeNull();
    expect(readBlobCredentials({ BLOB_STORE_ID: "store_abc" }, () => null)).toBeNull();
    expect(readBlobCredentials({ VERCEL_OIDC_TOKEN: "env-oidc-token" })).toBeNull();
    expect(
      readBlobCredentials({ BLOB_STORE_ID: "store/../x", VERCEL_OIDC_TOKEN: "env-oidc-token" }),
    ).toBeNull();
  });
});

describe("readNarrateConfig", () => {
  it("reads a complete environment, leaving the optional settings to their defaults", () => {
    expect(readNarrateConfig(NARRATE)).toEqual({
      blob: { token: BLOB_TOKEN },
      passphraseHash: NARRATE.GENERATE_PASSPHRASE_HASH,
      speechifyKey: "speechify-example-key",
    });
  });

  it("reads the voice and the monthly allowance when they are set", () => {
    expect(
      readNarrateConfig({
        ...NARRATE,
        SPEECHIFY_VOICE_ID: " henry_7 ",
        SPEECHIFY_MONTHLY_CHARS: "250000",
      }),
    ).toMatchObject({ voiceId: "henry_7", monthlyChars: 250_000 });
  });

  it("is null when a required variable is missing or blank", () => {
    for (const key of Object.keys(NARRATE)) {
      expect(readNarrateConfig({ ...NARRATE, [key]: undefined })).toBeNull();
      expect(readNarrateConfig({ ...NARRATE, [key]: "  " })).toBeNull();
    }
  });

  it("is null when an optional setting is present but unusable", () => {
    for (const bad of ["0", "-5", "12.5", "lots", "1e6"]) {
      expect(readNarrateConfig({ ...NARRATE, SPEECHIFY_MONTHLY_CHARS: bad })).toBeNull();
    }
    for (const bad of ["two words", "voice/../x", "x".repeat(65)]) {
      expect(readNarrateConfig({ ...NARRATE, SPEECHIFY_VOICE_ID: bad })).toBeNull();
    }
  });

  it("treats blank optional settings as unset", () => {
    expect(
      readNarrateConfig({ ...NARRATE, SPEECHIFY_VOICE_ID: "", SPEECHIFY_MONTHLY_CHARS: " " }),
    ).toEqual(readNarrateConfig(NARRATE));
  });

  it("does not need the GitHub variables", () => {
    expect(readServerConfig(NARRATE)).toBeNull();
    expect(readNarrateConfig(NARRATE)).not.toBeNull();
  });
});

describe("narrateSecretsOf", () => {
  it("lists the key, the hash and whichever Blob credential is in use", () => {
    expect(narrateSecretsOf(readNarrateConfig(NARRATE))).toEqual([
      "speechify-example-key",
      NARRATE.GENERATE_PASSPHRASE_HASH,
      BLOB_TOKEN,
    ]);
    expect(blobSecretsOf({ oidcToken: "oidc-token", storeId: "store_abc" })).toEqual([
      "oidc-token",
    ]);
    expect(narrateSecretsOf(null)).toEqual([]);
    expect(blobSecretsOf(null)).toEqual([]);
  });
});
