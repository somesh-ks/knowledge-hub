import { describe, expect, it, vi } from "vitest";
import {
  blobSecretsOf,
  narrateSecretsOf,
  readBlobCredentials,
  readNarrateConfig,
  readPublicBlobBase,
  readServerConfig,
  type ServerEnv,
  secretsOf,
} from "./config";

const GOOD = {
  GITHUB_DISPATCH_TOKEN: "github_pat_example",
  GITHUB_REPOSITORY: "somesh-ks/knowledge-hub",
};

describe("readServerConfig", () => {
  it("reads a complete environment", () => {
    expect(readServerConfig(GOOD)).toEqual({
      token: "github_pat_example",
      owner: "somesh-ks",
      repo: "knowledge-hub",
      repository: "somesh-ks/knowledge-hub",
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
  it("lists the token for the log redactor", () => {
    const config = readServerConfig(GOOD);
    expect(secretsOf(config)).toEqual([GOOD.GITHUB_DISPATCH_TOKEN]);
    expect(secretsOf(null)).toEqual([]);
  });
});

const BLOB_TOKEN = "vercel_blob_rw_example_0123456789abcdef";
const NARRATE = {
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

describe("readPublicBlobBase", () => {
  it("works the store's public address out from the read-write token", () => {
    expect(
      readPublicBlobBase({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbCd1234EfGh_secretsecret" }),
    ).toBe("https://abcd1234efgh.public.blob.vercel-storage.com");
  });

  it("works it out from the store id when there is no token", () => {
    expect(readPublicBlobBase({ BLOB_STORE_ID: "store_AbCd1234EfGh" })).toBe(
      "https://abcd1234efgh.public.blob.vercel-storage.com",
    );
    expect(readPublicBlobBase({ BLOB_STORE_ID: "AbCd1234EfGh" })).toBe(
      "https://abcd1234efgh.public.blob.vercel-storage.com",
    );
  });

  it("never includes the secret part of the token", () => {
    const base = readPublicBlobBase({
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbCd1234EfGh_thisIsTheSecretPart",
    });
    expect(base).not.toContain("thisIsTheSecretPart");
    expect(base?.toLowerCase()).not.toContain("thisisthesecretpart");
  });

  it("is null when no usable store name is configured", () => {
    for (const env of [
      {},
      { BLOB_READ_WRITE_TOKEN: "[SENSITIVE]" },
      { BLOB_READ_WRITE_TOKEN: "some-other-token" },
      { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_" },
      { BLOB_STORE_ID: "store_../../x" },
      { BLOB_STORE_ID: "store_evil.example/x" },
      { BLOB_STORE_ID: "short" },
    ]) {
      expect(readPublicBlobBase(env), JSON.stringify(env)).toBeNull();
    }
  });
});

describe("readNarrateConfig", () => {
  it("reads a complete environment, leaving the optional settings to their defaults", () => {
    expect(readNarrateConfig(NARRATE)).toEqual({
      blob: { token: BLOB_TOKEN },
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

  it("reads the second host's voice when it is set, and has none otherwise", () => {
    expect(readNarrateConfig({ ...NARRATE, SPEECHIFY_VOICE_ID_B: " second_7 " })).toMatchObject({
      voiceIdB: "second_7",
    });
    expect(readNarrateConfig(NARRATE)).not.toHaveProperty("voiceIdB");
    expect(readNarrateConfig({ ...NARRATE, SPEECHIFY_VOICE_ID_B: " " })).not.toHaveProperty(
      "voiceIdB",
    );
  });

  it("is null when the second host's voice is set to something unusable", () => {
    for (const bad of ["two words", "voice/../x", "x".repeat(65)]) {
      expect(readNarrateConfig({ ...NARRATE, SPEECHIFY_VOICE_ID_B: bad })).toBeNull();
    }
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
  it("lists the key and whichever Blob credential is in use", () => {
    expect(narrateSecretsOf(readNarrateConfig(NARRATE))).toEqual([
      "speechify-example-key",
      BLOB_TOKEN,
    ]);
    expect(blobSecretsOf({ oidcToken: "oidc-token", storeId: "store_abc" })).toEqual([
      "oidc-token",
    ]);
    expect(narrateSecretsOf(null)).toEqual([]);
    expect(blobSecretsOf(null)).toEqual([]);
  });
});

describe("withSecondVoice", () => {
  it("fills in the default second voice only when nothing sets one", async () => {
    const { DEFAULT_SECOND_VOICE, withSecondVoice } = await import("./config");
    const unset: ServerEnv = {};
    expect(withSecondVoice(unset).SPEECHIFY_VOICE_ID_B).toBe(DEFAULT_SECOND_VOICE);
    expect(withSecondVoice({ SPEECHIFY_VOICE_ID_B: "other_1" }).SPEECHIFY_VOICE_ID_B).toBe(
      "other_1",
    );
    // Blank is the owner saying one voice is wanted.
    expect(withSecondVoice({ SPEECHIFY_VOICE_ID_B: "" }).SPEECHIFY_VOICE_ID_B).toBe("");
  });
});
