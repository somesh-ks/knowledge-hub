import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type GateEnv, guard } from "./gate";
import { type Exchange, googleEnvFrom, type IdClaims } from "./google";
import { createSession, sessionValid } from "./session";

const ENV = { password: "correct horse battery staple", secret: "x".repeat(40) };
const NOW = Date.UTC(2026, 9, 29, 12);
const instant = async () => {};

const login = (password: string) =>
  guard(
    new Request("https://news.someshks.work/admin/login", {
      method: "POST",
      body: new URLSearchParams({ password }),
    }),
    ENV,
    NOW,
    instant,
  );
const visit = (path: string, cookie?: string, env: GateEnv = ENV) =>
  guard(
    new Request(`https://news.someshks.work${path}`, { headers: cookie ? { cookie } : {} }),
    env,
    NOW,
    instant,
  );

// A gate that fails open is invisible: every page still loads. These journeys keep it shut.
describe("the command center's gate", () => {
  it("sends a visitor without a session to the login page, and lets the page and its styles load", async () => {
    expect((await visit("/costs"))?.headers.get("location")).toBe("/admin/login");
    expect((await visit("/admin"))?.status).toBe(303);
    expect(await visit("/login")).toBeUndefined();
    expect(await visit("/admin/_astro/shell.abc123.css")).toBeUndefined();
  });

  it("opens only for the right password, and the session it sets opens the pages", async () => {
    const wrong = await login("wrong");
    expect(wrong?.headers.get("location")).toBe("/admin/login?e=1");
    expect(wrong?.headers.get("set-cookie")).toBeNull();

    const right = await login(ENV.password);
    const cookie = right?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(await visit("/costs", cookie.split(";")[0])).toBeUndefined();
  });

  it("rejects a forged, a tampered and an expired session", async () => {
    const good = await createSession(ENV.secret, NOW);
    const [ends = ""] = good.split(".");
    expect(await sessionValid(good, ENV.secret, NOW)).toBe(true);
    expect(
      await sessionValid(`${Number(ends) + 1000}.${good.split(".")[1]}`, ENV.secret, NOW),
    ).toBe(false);
    expect(await sessionValid(`${ends}.deadbeef`, ENV.secret, NOW)).toBe(false);
    expect(await sessionValid(good, ENV.secret, NOW + 31 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(await sessionValid(good, "y".repeat(40), NOW)).toBe(false);
  });

  it("opens nothing, the login page included, until a password and a long enough secret are set", async () => {
    expect(
      (await visit("/login", undefined, { password: undefined, secret: ENV.secret }))?.status,
    ).toBe(503);
    expect(
      (await visit("/costs", undefined, { password: ENV.password, secret: "short" }))?.status,
    ).toBe(503);
  });

  // The reader's /api/costs and /api/health check this cookie; one scoped to /admin never reaches them.
  it("sets the session for the whole domain and clears the old /admin one, as sign-out does", async () => {
    const cookie = (await login(ENV.password))?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("Path=/;");
    const issued = (await login(ENV.password))?.headers.getSetCookie() ?? [];
    expect(issued.some((line) => line.includes("Path=/admin;") && line.includes("Max-Age=0"))).toBe(
      true,
    );

    const out = await guard(
      new Request("https://news.someshks.work/admin/logout", { method: "POST" }),
      ENV,
      NOW,
      instant,
    );
    const cleared = out?.headers.getSetCookie() ?? [];
    expect(cleared.some((line) => line.includes("Path=/;"))).toBe(true);
    expect(cleared.some((line) => line.includes("Path=/admin;"))).toBe(true);
    expect(cleared.every((line) => line.includes("Max-Age=0"))).toBe(true);
  });
});

const GOOGLE = googleEnvFrom({
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://news.someshks.work/admin/login/google/callback",
  emails: "Owner@Example.com, second@example.com",
});
const WITH_GOOGLE: GateEnv = { ...ENV, google: GOOGLE };

/** A sign-in as the browser lives it: the gate sends it to Google, Google sends it back with a code. */
async function googleJourney(options: {
  claims?: (nonce: string) => Partial<IdClaims>;
  exchange?: Exchange;
  state?: (state: string) => string;
  cookie?: (cookie: string) => string | undefined;
  later?: number;
  env?: GateEnv;
}) {
  const env = options.env ?? WITH_GOOGLE;
  const start = await guard(
    new Request("https://news.someshks.work/admin/login/google"),
    env,
    NOW,
    instant,
  );
  const sent = new URL(start?.headers.get("location") ?? "");
  const nonce = sent.searchParams.get("nonce") ?? "";
  const state = sent.searchParams.get("state") ?? "";
  const set = start?.headers.getSetCookie()[0] ?? "";
  const kept = set.split(";")[0]?.split("=").slice(1).join("=") ?? "";
  const cookie = options.cookie ? options.cookie(kept) : kept;
  let verifier = "";
  const exchange: Exchange =
    options.exchange ??
    (async (_env, _code, sentVerifier) => {
      verifier = sentVerifier;
      return {
      iss: "https://accounts.google.com",
      aud: "client-id",
      exp: Math.floor(NOW / 1000) + 3600,
      nonce,
      email: "owner@example.com",
      email_verified: true,
      ...options.claims?.(nonce),
      };
    });
  const callback = await guard(
    new Request(
      `https://news.someshks.work/admin/login/google/callback?code=abc&state=${options.state ? options.state(state) : state}`,
      { headers: cookie ? { cookie: `singularity_admin_oauth=${cookie}` } : {} },
    ),
    env,
    NOW + (options.later ?? 1000),
    instant,
    exchange,
  );
  return { sent, set, callback, verifier: () => verifier };
}

describe("the command center's Google sign-in", () => {
  it("sends the browser to Google with a state, a nonce and a PKCE challenge, and keeps them in a cookie only its own address sees", async () => {
    const { sent, set, verifier } = await googleJourney({});
    expect(sent.origin + sent.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(sent.searchParams.get("code_challenge_method")).toBe("S256");
    // The challenge Google holds must be the hash of the verifier the callback hands back, or the
    // token endpoint refuses the sign-in and nothing here would have failed.
    expect(verifier()).not.toBe("");
    expect(sent.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier()).digest("base64url"),
    );
    expect(sent.searchParams.get("redirect_uri")).toBe(GOOGLE?.redirectUri);
    expect(sent.searchParams.get("scope")).toBe("openid email");
    expect(set).toContain("Path=/admin/login/google;");
    expect(set).toContain("HttpOnly");
  });

  it("lets the owner's account in, whatever its case, and the session it sets opens the pages", async () => {
    const { callback } = await googleJourney({ claims: () => ({ email: "OWNER@example.COM" }) });
    expect(callback?.headers.get("location")).toBe("/admin");
    const session = callback?.headers.getSetCookie().find((line) => line.includes("Path=/;"));
    expect(session).toBeDefined();
    expect(await visit("/costs", session?.split(";")[0], WITH_GOOGLE)).toBeUndefined();
  });

  // Each of these once passing would hand the command center to someone else.
  it.each([
    ["an account that is not on the list", { claims: () => ({ email: "stranger@example.com" }) }],
    ["an unverified address", { claims: () => ({ email_verified: false }) }],
    ["a token made for another app", { claims: () => ({ aud: "someone-else" }) }],
    ["a token from another issuer", { claims: () => ({ iss: "https://evil.example" }) }],
    ["an expired token", { claims: () => ({ exp: Math.floor(NOW / 1000) - 1 }) }],
    ["a nonce that is not ours", { claims: () => ({ nonce: "replayed" }) }],
    ["a state that is not ours", { state: () => "forged" }],
    ["no cookie (a callback begun in another browser)", { cookie: () => undefined }],
    [
      "a tampered cookie",
      // The signature's last character, changed to one it is not, so the cookie always differs.
      { cookie: (cookie: string) => cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0") },
    ],
    ["a sign-in left open past ten minutes", { later: 11 * 60 * 1000 }],
    [
      "Google's token endpoint failing",
      {
        exchange: async () => {
          throw new Error("token endpoint answered 400");
        },
      },
    ],
  ])("refuses %s", async (_name, options) => {
    const { callback } = await googleJourney(options);
    expect(callback?.headers.get("location")).toBe("/admin/login?e=3");
    expect(callback?.headers.getSetCookie().some((line) => line.includes("Path=/;"))).toBe(false);
  });

  it("says it is not set up, and opens nothing, while the Google variables are missing", async () => {
    const off = await guard(
      new Request("https://news.someshks.work/admin/login/google"),
      ENV,
      NOW,
      instant,
    );
    expect(off?.headers.get("location")).toBe("/admin/login?e=2");
    // Google alone is a way in; neither a password nor Google is not.
    expect(
      (await visit("/login", undefined, { secret: ENV.secret, google: GOOGLE }))?.status,
    ).toBeUndefined();
    expect((await visit("/login", undefined, { secret: ENV.secret }))?.status).toBe(503);
  });

  it("keeps the password working beside Google, and refuses it where there is none", async () => {
    const answer = await guard(
      new Request("https://news.someshks.work/admin/login", {
        method: "POST",
        body: new URLSearchParams({ password: "" }),
      }),
      { secret: ENV.secret, google: GOOGLE },
      NOW,
      instant,
    );
    expect(answer?.headers.get("location")).toBe("/admin/login?e=1");
    expect((await login(ENV.password))?.headers.get("location")).toBe("/admin");
  });
});
