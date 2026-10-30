import { describe, expect, it } from "vitest";
import { createSession } from "../../../admin/src/gate/session";
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
