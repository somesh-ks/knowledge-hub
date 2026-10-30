import { describe, expect, it } from "vitest";
import { type GateEnv, guard } from "./gate";
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
  it("sets the session for the whole domain, and sign-out clears it there and under the old /admin path", async () => {
    const cookie = (await login(ENV.password))?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("Path=/;");

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
