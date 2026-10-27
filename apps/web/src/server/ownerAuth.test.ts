import { describe, expect, it, vi } from "vitest";
import { OWNER_COOKIE, requireOwner, trustDevice } from "./ownerAuth";

const TOKEN = "owner-token-of-enough-length";
const env = { SINGULARITY_OWNER_TOKEN: TOKEN };
const post = (headers: Record<string, string> = {}) =>
  new Request("https://news.example/api/config", { method: "POST", headers });

describe("requireOwner", () => {
  it("refuses a write with no cookie and no bearer when the secret is set", async () => {
    const refusal = requireOwner(post({ origin: "https://news.example" }), env, vi.fn());
    expect(refusal?.status).toBe(401);
    expect(await refusal?.json()).toEqual({ error: "owner_required" });
  });

  it("lets a write through when the secret is unset, and warns", () => {
    const warn = vi.fn();
    expect(requireOwner(post(), {}, warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("accepts the owner cookie and the bearer header", () => {
    expect(
      requireOwner(post({ cookie: `a=b; ${OWNER_COOKIE}=${TOKEN}` }), env, vi.fn()),
    ).toBeNull();
    expect(requireOwner(post({ authorization: `Bearer ${TOKEN}` }), env, vi.fn())).toBeNull();
  });

  it("refuses a wrong cookie or bearer, of any length", () => {
    for (const given of ["x", `${TOKEN}x`, TOKEN.slice(0, -1), "y".repeat(5000)]) {
      const cookie = post({ cookie: `${OWNER_COOKIE}=${given}` });
      const bearer = post({ authorization: `Bearer ${given}` });
      expect(requireOwner(cookie, env, vi.fn())?.status).toBe(401);
      expect(requireOwner(bearer, env, vi.fn())?.status).toBe(401);
    }
  });

  it("treats a secret under 16 characters as unset", () => {
    expect(requireOwner(post(), { SINGULARITY_OWNER_TOKEN: "short" }, vi.fn())).toBeNull();
  });
});

describe("trustDevice", () => {
  const input = (token: unknown, origin: string | null = "https://news.example") => ({
    bodyText: JSON.stringify({ token }),
    origin,
    expectedOrigin: "https://news.example",
  });

  it("sets an HttpOnly, Secure, SameSite=Strict cookie for the right token", () => {
    const result = trustDevice(input(TOKEN), env);
    expect(result.status).toBe(204);
    const cookie = result.headers?.["Set-Cookie"] ?? "";
    expect(cookie).toContain(`${OWNER_COOKIE}=${TOKEN}`);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      expect(cookie).toContain(flag);
    }
  });

  it("refuses a wrong token, another origin, and a site with no secret", () => {
    expect(trustDevice(input("nope"), env).status).toBe(401);
    expect(trustDevice(input(TOKEN, "https://evil.example"), env).status).toBe(403);
    expect(trustDevice(input(TOKEN), {}).status).toBe(409);
  });
});
