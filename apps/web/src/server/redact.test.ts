import { describe, expect, it } from "vitest";
import { describeError, redact } from "./redact";

const TOKEN = "github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz0123456789";
const HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g=";

describe("redact", () => {
  it("removes the exact secrets it was given", () => {
    expect(redact(`token ${TOKEN} failed`, [TOKEN])).toBe("token [redacted] failed");
  });

  it("removes every occurrence", () => {
    expect(redact(`${TOKEN} and ${TOKEN}`, [TOKEN])).toBe("[redacted] and [redacted]");
  });

  it("removes GitHub token shapes even when it was not told the value", () => {
    expect(redact(`header ${TOKEN}`)).toBe("header [redacted]");
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe("[redacted]");
    expect(redact("gho_abcdefghijklmnopqrstuvwxyz0123456789")).toBe("[redacted]");
  });

  it("removes a passphrase hash by shape", () => {
    expect(redact(`env GENERATE_PASSPHRASE_HASH=${HASH}`)).toBe(
      "env GENERATE_PASSPHRASE_HASH=[redacted]",
    );
  });

  it("removes a Vercel Blob token and an OIDC token by shape", () => {
    expect(redact("put failed for vercel_blob_rw_AbCd1234EfGh5678_ijklmnopqrstuvwx")).toBe(
      "put failed for [redacted]",
    );
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvd25lcjpkaXNwYXRjaCJ9.c2lnbmF0dXJlLWJ5dGVz";
    expect(redact(`Authorization: Bearer ${jwt}`)).toBe("Authorization: Bearer [redacted]");
  });

  it("ignores undefined and very short secrets so ordinary words survive", () => {
    expect(redact("a short word", [undefined, "short", ""])).toBe("a short word");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("GitHub answered 403")).toBe("GitHub answered 403");
    expect(redact("narrate 2026-10-07: stored. 9012 characters, synthesis 41200 ms")).toBe(
      "narrate 2026-10-07: stored. 9012 characters, synthesis 41200 ms",
    );
  });
});

describe("describeError", () => {
  it("names the error without a stack and without secrets", () => {
    const error = new Error(`request with ${TOKEN} failed`);
    const text = describeError(error, [TOKEN]);
    expect(text).toBe("Error: request with [redacted] failed");
    expect(text).not.toContain("at ");
  });

  it("handles values that are not errors", () => {
    expect(describeError("boom", [])).toBe("boom");
  });
});
