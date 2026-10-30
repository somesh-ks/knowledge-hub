import type { APIContext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../../../admin/src/gate/session";
import { GET as costs } from "../pages/api/costs";
import { GET as health } from "../pages/api/health";
import { adminOnly } from "./adminGuard";

const SECRET = "x".repeat(40);
const NOW = Date.UTC(2026, 9, 30, 12);
const ask = (cookie?: string) =>
  new Request("https://news.someshks.work/api/costs", { headers: cookie ? { cookie } : {} });

// The bug it prevents: spend and health readable by anyone with the URL.
describe("the report routes' admin guard", () => {
  it("answers only a request that carries a live command center session", async () => {
    const session = await createSession(SECRET, NOW);
    expect(
      await adminOnly(ask(`singularity_admin=${session}`), { secret: SECRET }, NOW),
    ).toBeNull();

    for (const cookie of [
      undefined,
      "singularity_admin=",
      `singularity_admin=${session}0`,
      `singularity_admin=${await createSession("y".repeat(40), NOW)}`,
    ]) {
      expect((await adminOnly(ask(cookie), { secret: SECRET }, NOW))?.status).toBe(401);
    }
    const later = NOW + 31 * 24 * 60 * 60 * 1000;
    expect(
      (await adminOnly(ask(`singularity_admin=${session}`), { secret: SECRET }, later))?.status,
    ).toBe(401);
  });

  it("answers nobody until a long enough secret is set, as the gate does", async () => {
    const session = await createSession(SECRET, NOW);
    for (const secret of [undefined, "", "short"]) {
      const refused = await adminOnly(ask(`singularity_admin=${session}`), { secret }, NOW);
      expect(refused?.status).toBe(503);
    }
  });

  it("lets local development through, where the command center's dev proxy sends no cookie", async () => {
    expect(await adminOnly(ask(), { dev: true }, NOW)).toBeNull();
  });
});

// The bug it prevents: a route that stops calling the guard. Vitest runs with DEV on, which bypasses
// it, so these switch to the production setting and send a request without a session.
describe("the report routes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["/api/costs", costs],
    ["/api/health", health],
  ])("%s refuses a request without the session before any report work", async (path, route) => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
    const request = new Request(`https://news.someshks.work${path}`);
    const answer = await route({ request, url: new URL(request.url) } as APIContext);
    expect((answer as Response).status).toBe(401);
  });
});
