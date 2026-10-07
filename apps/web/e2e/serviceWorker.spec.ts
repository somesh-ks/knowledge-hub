import { expect, test } from "./fixtures";

test.describe("service worker", () => {
  test("registers after load and controls the page", async ({ page }) => {
    await page.goto("/");
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      const worker = ready.active;
      if (worker && worker.state !== "activated") {
        await new Promise<void>((resolve) => {
          worker.addEventListener("statechange", () => worker.state === "activated" && resolve());
        });
      }
      return {
        scope: ready.scope,
        active: worker?.state ?? null,
        script: worker?.scriptURL ?? null,
      };
    });
    expect(registration.scope).toMatch(/\/$/);
    expect(registration.active).toBe("activated");
    expect(registration.script).toMatch(/\/sw\.js$/);
  });

  test("precaches the shell and the offline page", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
      }
      return { names, urls };
    });
    expect(cached.names).toContain("dispatch-shell-v1");
    expect(cached.urls).toContain("/offline");
    expect(cached.urls).toContain("/");
    expect(cached.urls.some((url) => url.startsWith("/_astro/") && url.endsWith(".css"))).toBe(
      true,
    );
    expect(cached.urls.some((url) => url.endsWith(".woff2"))).toBe(true);
    expect(cached.urls.some((url) => url.startsWith("/_astro/") && url.endsWith(".js"))).toBe(true);
  });

  test("never caches audio, even when the page streams it", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(async () => {
      const audio = new Audio("/fixtures/audio.wav");
      audio.preload = "auto";
      await new Promise<void>((resolve) => {
        audio.addEventListener("canplaythrough", () => resolve(), { once: true });
        audio.addEventListener("error", () => resolve(), { once: true });
        audio.load();
      });
      await fetch("/fixtures/audio.wav");
      await fetch("/fixtures/audio.wav", { headers: { Range: "bytes=0-99" } });
    });
    const audioEntries = await page.evaluate(async () => {
      const found: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (/\.(wav|mp3|m4a|ogg)$/.test(request.url)) found.push(request.url);
        }
      }
      return found;
    });
    expect(audioEntries).toEqual([]);
  });

  test("keeps the reading experience available offline", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    // A second visit lets the worker store this page and its covers.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".story")).toHaveCount(12);
    await expect(page.locator('[data-banner="offline"]')).toBeVisible();
    await context.setOffline(false);
  });

  test.describe("offline without a saved copy", () => {
    test.use({ allowNetworkErrors: true });

    test("shows the offline page for a briefing it has never opened", async ({ page, context }) => {
      await page.goto("/");
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await context.setOffline(true);
      await page.goto("/d/2026-10-04-weekly");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are offline");
      await context.setOffline(false);
    });
  });

  test("serves a saved digest page while it checks for a newer one", async ({ page, context }) => {
    await page.goto("/d/2026-10-05");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.goto("/d/2026-10-05");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
    await context.setOffline(false);
  });

  test("serves the manifest with its icons", async ({ page, request }) => {
    await page.goto("/");
    const response = await request.get("/manifest.webmanifest");
    expect(response.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = await response.json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    for (const icon of manifest.icons) {
      const file = await request.get(icon.src);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toBe("image/png");
    }
  });
});
