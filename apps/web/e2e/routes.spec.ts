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
    await expect(page.locator("main .empty-actions a")).toHaveCount(1);
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

  test("the not found page for a missing podcast or episode reads the same", async ({ page }) => {
    for (const path of ["/d/1999-01-01", "/e/ep-none"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      // Nothing names a podcast for a missing episode.
      await expect(page.locator("#main")).not.toContainText("podcast");
    }
  });

  test("an older podcast leads back to where the person came from", async ({ page }) => {
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

  // Bug (owner, 2026-11-01): the offline notice sat in the page, so opening a podcast from the Library
  // while offline pushed the destination down after it landed and the album art jumped. The strip is
  // above the app now: it squeezes everything down once, as it opens, and a page opened under it
  // lands where it stays.
  test("the offline strip squeezes the page once, says when the connection is back, then lifts", {
    tag: "@both",
  }, async ({ page }) => {
    await page.goto("/");
    // The browser's own signal, set by hand: no request fails, so nothing else is blamed.
    const setOnline = (online: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(navigator, "onLine", { value, configurable: true });
        window.dispatchEvent(new Event(value ? "online" : "offline"));
      }, online);
    const top = () => page.locator("#main").evaluate((el) => el.getBoundingClientRect().top);
    const resting = await top();
    await setOnline(false);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
    await setOnline(false);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
    // Squeezed, not covered: the page starts below the strip.
    await expect.poll(top).toBeGreaterThan(resting);
    const squeezed = await top();
    // Pages opened under the strip land where they stay. The page and, on a podcast, its cover are
    // sampled every frame from the click, so a shift during the swap shows as much as one after it.
    await page.evaluate(() => {
      const seen: [string, string][] = [];
      (window as unknown as { __seen: typeof seen }).__seen = seen;
      const tick = () => {
        const main = document.querySelector("#main")?.getBoundingClientRect().top;
        const cover = document.querySelector(".hero .cover")?.getBoundingClientRect();
        const box = cover ? [cover.top, cover.width, cover.height].join(",") : "";
        if (main !== undefined) seen.push([location.pathname, `${main}|${box}`]);
        requestAnimationFrame(tick);
      };
      tick();
    });
    const settle = () =>
      page.evaluate(async () => {
        // The page's own transition over, plus a few more frames: whatever moves after it is a bug.
        const finite = document
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0));
        await Promise.allSettled(finite.map((a) => a.finished));
        for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
      });
    const samples = (path: RegExp) =>
      page.evaluate(
        (source) =>
          (window as unknown as { __seen: [string, string][] }).__seen
            .filter(([p]) => new RegExp(source).test(p))
            .map(([, v]) => v),
        path.source,
      );
    await page.locator('.app-nav a[href="/library"]').click();
    await expect(page).toHaveURL(/\/library/);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
    await settle();
    const landed = await top();
    const libraryTops = (await samples(/^\/library$/)).map((v) => v.split("|")[0]);
    expect(new Set(libraryTops)).toEqual(new Set([String(landed)]));
    expect(landed).toBeGreaterThanOrEqual(squeezed);
    // The reported case: a podcast opened from the Library. Its cover keeps its top and size from the
    // first frame it exists, compared to itself (the page's own slide in moves it sideways, not down).
    await page.locator('a[href="/d/2026-10-05"]').first().click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(1);
    await settle();
    const podcast = (await samples(/^\/d\//)).map((v) => v.split("|")[1]).filter(Boolean);
    expect(podcast.length).toBeGreaterThan(0);
    expect(new Set(podcast).size).toBe(1);
    await setOnline(true);
    await expect(page.locator('[data-banner="offline"]')).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-offline", "");
    await expect(page.locator('[data-banner="online"]')).toHaveCount(1);
    await expect(page.locator('[data-banner="online"]')).toHaveCount(0);
    await expect.poll(top).toBeLessThan(landed);
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
