import { expect, ROUTES, test } from "./fixtures";

test.describe("routes and headers", () => {
  test("every route answers and stays on this origin", async ({ page }) => {
    for (const route of ROUTES) {
      const external: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.hostname !== "127.0.0.1") external.push(request.url());
      });
      const response = await page.goto(route.path);
      expect(response?.status(), route.path).toBe(route.name === "not found" ? 404 : 200);
      expect(external, `${route.path} should load nothing from other origins`).toEqual([]);
      page.removeAllListeners("request");
    }
  });

  test("the not found page names the problem and offers a way on", async ({ page }) => {
    const response = await page.goto("/no/such/page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.getByRole("link", { name: "Open today's briefing" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  test("the offline page explains itself", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are offline");
    await expect(page.getByText("Open a briefing you have read before")).toBeVisible();
  });

  test("latest.json lists only the whitelisted fields", async ({ request }) => {
    const response = await request.get("/latest.json");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-cache");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "date",
      "generated_at",
      "id",
      "kind",
      "outcome",
      "outcome_at",
    ]);
    expect(body).toMatchObject({
      id: "2026-10-07",
      date: "2026-10-07",
      kind: "regular",
      outcome: "published",
    });
  });

  test("robots.txt disallows everything and there is no sitemap", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Disallow: /");
    expect((await request.get("/sitemap.xml")).status()).toBe(404);
    expect((await request.get("/sitemap-index.xml")).status()).toBe(404);
  });

  test("every response carries the security and no-index headers", async ({ request }) => {
    for (const path of [
      "/",
      "/library",
      "/d/2026-10-07",
      "/latest.json",
      "/manifest.webmanifest",
      "/sw.js",
    ]) {
      const headers = (await request.get(path)).headers();
      expect(headers["x-robots-tag"], path).toBe("noindex, nofollow");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("no-referrer");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["content-security-policy"], path).toContain(
        "media-src 'self' https://*.public.blob.vercel-storage.com",
      );
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    }
  });

  test("caching: assets are immutable, the service worker and pages are not cached", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const asset = await page.locator('link[rel="stylesheet"]').first().getAttribute("href");
    expect((await request.get(asset ?? "")).headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await request.get("/sw.js")).headers()["cache-control"]).toBe("no-cache");
    expect((await request.get("/")).headers()["cache-control"]).toBe("no-cache");
    expect((await request.get("/d/2026-10-07")).headers()["cache-control"]).toBe("no-cache");
  });

  test("every inline script on every page is allowed by the policy's hashes", async ({
    request,
  }) => {
    for (const route of ROUTES) {
      const html = await (await request.get(route.path)).text();
      const policy = /http-equiv="content-security-policy" content="([^"]*)"/.exec(html)?.[1] ?? "";
      expect(policy, route.path).toContain("script-src 'self'");
      expect(policy, route.path).not.toContain("'unsafe-inline' ".concat("'self'"));
      const scriptSrc =
        policy.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
      expect(scriptSrc, route.path).not.toContain("unsafe-inline");
      expect(scriptSrc, route.path).not.toContain("unsafe-eval");
    }
  });

  test("no page carries an inline module script, which the router answers with a blocked data: script", async ({
    request,
  }) => {
    // When the router swaps in a page whose last module script is inline, it adds
    // <script src="data:application/javascript,"> to wait for it, and the policy blocks that.
    for (const route of ROUTES) {
      const html = await (await request.get(route.path)).text();
      expect(html.match(/<script type="module">/g) ?? [], route.path).toEqual([]);
    }
  });

  test("a javascript: link in a digest cannot run", async ({ page }) => {
    // The data layer renders only http and https links; here the policy is the second line of defense.
    await page.goto("/");
    const unsafe = await page.locator('a[href^="javascript:"]').count();
    expect(unsafe).toBe(0);
  });
});
