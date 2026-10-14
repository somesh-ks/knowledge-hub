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
    await expect(page.getByRole("link", { name: "Go to Latest" })).toHaveAttribute("href", "/");
    // One way on: the navigation already carries the rest. The body does not repeat the button.
    await expect(page.locator(".empty-actions a")).toHaveCount(1);
    await expect(page.locator("#main .empty-body")).toHaveText(
      "Check the address, or start again from Today.",
    );
    // From 80rem the empty state centres in the pane, not in the reading track beside an empty aside.
    const size = page.viewportSize();
    if (size && size.width >= 1280) {
      const main = await page.locator("#main").boundingBox();
      const pane = await page.locator(".shell").boundingBox();
      const middle = (box: { x: number; width: number } | null) =>
        box ? box.x + box.width / 2 : 0;
      expect(Math.abs(middle(main) - middle(pane))).toBeLessThan(2);
    }
  });

  test("the not found page for a missing briefing or episode reads the same", async ({ page }) => {
    for (const path of ["/d/1999-01-01", "/e/ep-none"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      // Nothing names a briefing for a missing episode.
      await expect(page.locator("#main")).not.toContainText("briefing");
    }
  });

  test("an older briefing leads back to where the person came from", async ({ page }) => {
    await page.goto("/library");
    await page.locator('a[href="/d/2026-10-05"]').first().click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/library$/);
    // Opened cold, it falls back to the Library.
    await page.goto("/d/2026-10-05");
    await expect(page.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/library");
    // Today has none.
    await page.goto("/");
    // Exact: a headline is a link too, and one may hold the word.
    await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveCount(0);
  });

  test("the offline banner shows once and clears when the connection returns", async ({ page }) => {
    await page.goto("/");
    // The browser's own signal, set by hand: no request fails, so nothing else is blamed.
    const setOnline = (online: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(navigator, "onLine", { value, configurable: true });
        window.dispatchEvent(new Event(value ? "online" : "offline"));
      }, online);
    await setOnline(false);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
    await setOnline(false);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
    await setOnline(true);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-offline", "");
  });

  test("the app bar goes inert while slid away and returns on a scroll up", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/d/2026-10-05");
    const bar = page.locator(".app-bar");
    await page.mouse.wheel(0, 900);
    await expect(page.locator("html")).toHaveAttribute("data-bar-hidden", "");
    await expect(bar).toHaveJSProperty("inert", true);
    await page.mouse.wheel(0, -200);
    await expect(page.locator("html")).not.toHaveAttribute("data-bar-hidden", "");
    await expect(bar).toHaveJSProperty("inert", false);
  });

  test("the offline page says when the connection is back, and speaks once", async ({ page }) => {
    await page.goto("/offline");
    // Online, the page never claims to be offline: it says the connection is back.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are back online");
    // The cut-signal scene goes with the offline state: the connected one with its check stands in.
    await expect(page.locator("#main .empty")).toHaveAttribute("data-state", "online");
    await expect(page.locator('#main .empty-art[data-art="online"]')).toBeVisible();
    await expect(page.locator('#main .empty-art[data-art="offline"]')).toBeHidden();
    await expect(page.getByRole("link", { name: "Reload" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Library" })).toHaveAttribute(
      "href",
      "/library",
    );
    // The page is the message: no banner repeats it.
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(0);
  });

  test("latest.json lists only the whitelisted fields", async ({ request }) => {
    const response = await request.get("/latest.json");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-cache");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "date",
      // The newest episode, so a page that asked for one can see it go live.
      "episode_at",
      "episode_id",
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
