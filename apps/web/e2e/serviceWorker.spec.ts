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
    // The name carries a version, bumped with the shell; serviceWorker.test.ts holds which.
    expect(cached.names.some((name) => /^singularity-shell-v\d+$/.test(name))).toBe(true);
    expect(cached.urls).toContain("/offline");
    expect(cached.urls).toContain("/");
    expect(cached.urls.some((url) => url.startsWith("/_astro/") && url.endsWith(".css"))).toBe(
      true,
    );
    expect(cached.urls.some((url) => url.endsWith(".woff2"))).toBe(true);
    expect(cached.urls.some((url) => url.startsWith("/_astro/") && url.endsWith(".js"))).toBe(true);
  });

  test("saves a file the page fetches at run time, so it is there offline later", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    // A lazy chunk no page was warmed for is fetched by the page itself: a stylesheet under a query
    // string stands in for it, since each address is its own entry.
    const url = await page.evaluate(async () => {
      const sheet = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
        .map((link) => new URL(link.href))
        .find((address) => address.pathname.startsWith("/_astro/"));
      if (!sheet) throw new Error("no stylesheet to stand in");
      const address = `${sheet.pathname}?run-time=${Date.now()}`;
      const response = await fetch(address);
      await response.arrayBuffer();
      return address;
    });
    await expect
      .poll(() =>
        page.evaluate(async (address) => (await caches.match(address)) !== undefined, url),
      )
      .toBe(true);
  });

  test("keeps every script a settings page loads, so its editor works in a later session offline", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.goto("/settings/daily");
    await page.waitForLoadState("networkidle");
    const missing = () =>
      page.evaluate(async () => {
        const loaded = performance
          .getEntriesByType("resource")
          .map((entry) => new URL(entry.name).pathname)
          .filter((path) => path.startsWith("/_astro/") && path.endsWith(".js"));
        const absent: string[] = [];
        for (const path of loaded) if (!(await caches.match(path))) absent.push(path);
        return { count: loaded.length, absent };
      });
    await expect.poll(async () => (await missing()).absent).toEqual([]);
    expect((await missing()).count).toBeGreaterThan(10);
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

    test("shows the offline page for a podcast it has never opened", async ({ page, context }) => {
      await page.goto("/");
      await page.evaluate(() => navigator.serviceWorker.ready);
      // The worker stores the islands' stylesheets as the page fetches them at idle: going offline
      // before that left the offline page unable to preload one (a race seen on a slow runner).
      await page.reload();
      await page.waitForLoadState("networkidle");
      await context.setOffline(true);
      await page.goto("/d/2026-10-04-weekly");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("You are offline");
      await context.setOffline(false);
    });
  });

  test("serves a saved digest page offline", async ({ page, context }) => {
    await page.goto("/d/2026-10-05");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.goto("/d/2026-10-05");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
    await context.setOffline(false);
  });

  // 2026-10-21: the owner's phone kept a saved briefing's old HTML, and the old stylesheets it names,
  // after a deploy had changed both. A deploy must show on the next visit; an installed app's return
  // to the front loads it by itself (D202), with no prompt, but never over a reader's typing.
  test("shows a deploy on the next visit, and loads it by itself when the app comes back", async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await page.goto("/d/2026-10-05");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForLoadState("networkidle");
    // The deploy: every page names a new build, and so does /build.json (e2e/staticServer.mjs).
    const deploy = "next-deploy";
    const ship = () =>
      context.addCookies([
        { name: "test-build", value: deploy, url: new URL("/", page.url()).href },
      ]);
    const build = () =>
      page.evaluate(
        () =>
          document.querySelector('meta[name="singularity-build"]')?.getAttribute("content") ?? "",
      );
    await ship();
    await page.goto("/");
    await page.goto("/d/2026-10-05");
    expect(await build()).toBe(deploy);
    // An installed app comes back to the front with the page it left, a build behind the site.
    await context.clearCookies();
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await build()).not.toBe(deploy);
    // A reload would drop this mark with the page.
    await page.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
      const draft = document.createElement("textarea");
      draft.id = "draft";
      // A field the page filled in itself (a restored filter) is not the reader's typing.
      const restored = document.createElement("input");
      restored.value = "filled by the page";
      document.body.append(draft, restored);
    });
    await page.locator("#draft").fill("half a note");
    await page.locator("#draft").blur();
    await ship();
    const kept = () =>
      page.evaluate(() => (window as unknown as { kept?: boolean }).kept).catch(() => undefined);
    // A return to the front, a minute past the last check, told again until the page listens
    // (it does once the worker registers).
    const comeBack = async () => {
      await page.clock.fastForward(61_000);
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    };
    // Typed text is not thrown away: the page stays, and no prompt asks for a reload.
    for (let attempt = 0; attempt < 5; attempt += 1) await comeBack();
    await page.clock.fastForward(30_000);
    expect(await kept()).toBe(true);
    expect(await build()).not.toBe(deploy);
    await expect(
      page.getByRole("status").getByRole("button").filter({ hasText: /\S/ }),
    ).toHaveCount(0);
    // Once the text is cleared (the field stays mounted) nothing is left to lose, and the page
    // loads the deploy by itself.
    await page.locator("#draft").fill("");
    await page.locator("#draft").blur();
    await page.clock.fastForward(10_000);
    await expect.poll(() => build().catch(() => "")).toBe(deploy);
    expect(await kept()).toBeUndefined();
  });

  // REL-12: a move inside the app swapped in a page of the new deploy under the old bundle, so new
  // markup met old scripts and in-memory state until the next update check. That move must load in full.
  test("a move to a page of a newer deploy loads in full instead of swapping in", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const build = () =>
      page.evaluate(
        () =>
          document.querySelector('meta[name="singularity-build"]')?.getAttribute("content") ?? "",
      );
    const before = await build();
    await page.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
    // The worker answers a recent saved page at once; a page it has no copy of comes from the network,
    // which is the deploy.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name);
    });
    await context.addCookies([
      { name: "test-build", value: "next-deploy", url: new URL("/", page.url()).href },
    ]);
    await page.locator('.app-nav a[href="/library"]').click();
    await expect(page).toHaveURL(/\/library/);
    await expect.poll(() => build().catch(() => before)).toBe("next-deploy");
    // A full load drops what the old bundle held in memory.
    expect(
      await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
    ).toBeUndefined();
    // A move between pages of one build stays in the app.
    await page.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
    await page.locator('.app-nav a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    // A full load would stop the narration: while it plays, the move swaps in and the update waits.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      document.documentElement.dataset.playerState = "playing";
    });
    await context.addCookies([
      { name: "test-build", value: "later-deploy", url: new URL("/", page.url()).href },
    ]);
    await page.locator('.app-nav a[href="/library"]').click();
    await expect(page).toHaveURL(/\/library/);
    await expect.poll(() => build()).toBe("later-deploy");
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  });

  // A title typed and left before the page finished loading (the load event waits on a slow image
  // here) must survive the deploy that is waiting: the update check starts only after load, and
  // used to know nothing of text typed before it.
  test("keeps a title typed before the page finished loading", async ({ page }) => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/__slow.png", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) });
    });
    // A newer build than the page names, so the first check after load finds a deploy waiting.
    await page.route("**/build.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"build":"newer"}' }),
    );
    await page.addInitScript(() => {
      addEventListener("DOMContentLoaded", () => {
        const image = new Image();
        image.hidden = true;
        image.src = "/__slow.png";
        document.body.append(image);
      });
    });
    await page.goto("/create", { waitUntil: "domcontentloaded" });
    const title = page.locator("#create-title");
    await title.fill("my title");
    await title.blur();
    await page.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
    const checked = page.waitForResponse("**/build.json");
    release();
    await checked;
    // The reload, had the check allowed it, starts in the same turn as the answer.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(0))));
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    await expect(title).toHaveValue("my title");
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
