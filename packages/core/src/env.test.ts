import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("treats empty strings as unset", () => {
    expect(loadEnv({ BLOB_READ_WRITE_TOKEN: "" }).BLOB_READ_WRITE_TOKEN).toBeUndefined();
  });

  it("treats the placeholder `vercel env pull` writes for hidden secrets as unset", () => {
    const env = loadEnv({
      BLOB_READ_WRITE_TOKEN: "[SENSITIVE]",
      VERCEL_OIDC_TOKEN: "oidc-token-value",
      BLOB_STORE_ID: "store_x",
    });
    expect(env.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    expect(env.VERCEL_OIDC_TOKEN).toBe("oidc-token-value");
  });
});
