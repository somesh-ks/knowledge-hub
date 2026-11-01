import { expect, holdFinger, hydrated, openRowMenu, test } from "./fixtures";

/** The podcast with an audio file: the only kind a row can download. */
const AUDIO_ID = "2026-10-07";
const row = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-card][data-id="${id}"]`);

async function openMenu(page: import("@playwright/test").Page, id: string) {
  await openRowMenu(page, row(page, id));
  await expect(row(page, id).locator(".menu-list")).toBeVisible();
}

test("a row's menu shares a link when the browser has no share sheet, and queues the item without opening it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
      configurable: true,
    });
    Object.assign(window, { copied, queued: [] as string[] });
    document.addEventListener("singularity:queue-add", (event) =>
      (window as unknown as { queued: string[] }).queued.push((event as CustomEvent).detail.id),
    );
  });
  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");

  await openMenu(page, AUDIO_ID);
  await row(page, AUDIO_ID).getByRole("menuitem", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share link" });
  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied[0]).toContain(`/d/${AUDIO_ID}`);

  await openMenu(page, AUDIO_ID);
  await row(page, AUDIO_ID).getByRole("menuitem", { name: "Add to queue" }).click();
  await expect(page.getByText("Added to queue")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { queued: string[] }).queued)).toEqual([
    AUDIO_ID,
  ]);
  // The menu is not the card's link: the pick left the Library where it was.
  expect(new URL(page.url()).pathname).toBe("/library");
});

test("a podcast page's More menu downloads and queues the podcast, as its row in the Library does", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { queued: [] as string[] });
    document.addEventListener("singularity:queue-add", (event) =>
      (window as unknown as { queued: string[] }).queued.push((event as CustomEvent).detail.id),
    );
  });
  await page.goto(`/d/${AUDIO_ID}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const menu = page.locator("[data-page-menu]");
  await expect(menu).toHaveAttribute("data-menus-ready", "");
  const open = async () => {
    await menu.locator("[data-hero-more]").click();
    await expect(menu.locator(".menu-list")).toBeVisible();
  };

  await open();
  await menu.getByRole("menuitem", { name: "Add to queue" }).click();
  await expect(page.getByText("Added to queue")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { queued: string[] }).queued)).toEqual([
    AUDIO_ID,
  ]);

  await open();
  await menu.getByRole("menuitem", { name: "Download" }).click();
  await expect(menu).toHaveAttribute("data-downloaded", "");
  // Still marked after a reload: the state comes from Cache Storage, as in the Library.
  await page.reload();
  await expect(menu).toHaveAttribute("data-downloaded", "");
  // The header says so beside the story count, not only the menu's wording.
  await expect(page.locator(".hero-facts .hero-downloaded")).toBeVisible();
  await open();
  await expect(menu.getByRole("menuitem", { name: "Remove download" })).toBeVisible();
});

test("pressing a row's three dots moves nothing: not the card, its title or the dots' own glyph, and they sit beside the title", {
  tag: "@desktop",
}, async ({ page }) => {
  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  const card = row(page, AUDIO_ID);
  const more = card.locator("[data-hero-more]");
  const boxes = async () =>
    Promise.all(
      [card, card.locator(".card-title"), more.locator("svg")].map((n) => n.boundingBox()),
    );
  const rest = await boxes();
  const dots = (await more.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  await page.mouse.move(dots.x + dots.width / 2, dots.y + dots.height / 2);
  await page.mouse.down();
  // Past the press's transition: a scale would have settled by now.
  await page.waitForTimeout(300);
  expect(await boxes()).toEqual(rest);
  await page.mouse.up();
  // The dots sit beside the title, not over the art: below the cover, level with the title's first line.
  const cover = (await card.locator(".cover").first().boundingBox()) as {
    y: number;
    height: number;
  };
  const title = rest[1] as { y: number };
  expect(dots.y + dots.height / 2).toBeGreaterThan(cover.y + cover.height);
  expect(Math.abs(dots.y + dots.height / 2 - (title.y + 12))).toBeLessThan(8);
});

test("opening a row's menu leaves the card stack where it was", { tag: "@both" }, async ({
  page,
}) => {
  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  const stack = page.locator("[data-library]");
  const card = row(page, AUDIO_ID);
  const boxes = () => Promise.all([stack, card].map((n) => n.boundingBox()));
  const rest = await boxes();
  await openMenu(page, AUDIO_ID);
  // Past the sheet's slide in: a scrollbar taken away or a padding added would have landed.
  await page.waitForTimeout(400);
  expect(await boxes()).toEqual(rest);
});

test.describe("a podcast download", () => {
  // Offline, a cover the download did not save fails to load; the player's art is not under test.
  test.use({ allowNetworkErrors: true });

  test("a downloaded podcast opens offline and its audio is answered from the saved file, Range included", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      // The player's audio element is never in the page: take hold of the one it makes.
      const Original = window.Audio;
      window.Audio = class extends Original {
        constructor(src?: string) {
          super(src);
          Object.assign(window, { played: this });
        }
      } as typeof Audio;
    });
    await page.goto("/library");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");

    await openMenu(page, AUDIO_ID);
    await row(page, AUDIO_ID).getByRole("menuitem", { name: "Download" }).click();
    await expect(row(page, AUDIO_ID)).toHaveAttribute("data-downloaded", "");
    await expect(row(page, AUDIO_ID).locator(".card-sub .card-downloaded")).toContainText(
      "Downloaded",
    );

    // Still marked after a reload: the state comes from Cache Storage, not from the page.
    await page.reload();
    await expect(row(page, AUDIO_ID)).toHaveAttribute("data-downloaded", "");
    const audio = await row(page, AUDIO_ID)
      .locator("[data-library-menu]")
      .getAttribute("data-audio");

    // A deploy that updates the worker drops every cache but the downloads, and renames the hashed
    // scripts and styles, so the saved page's own files are nowhere else: a download stands on what
    // it saved (2026-10-22, the player did not start offline on the owner's phone).
    await page.evaluate(async () => {
      for (const name of await caches.keys())
        if (!name.includes("audio")) await caches.delete(name);
    });
    await context.setOffline(true);
    // Offline does not always reach the worker's own requests here (it does on CI): covers and the
    // hashed files fail as they would on a phone.
    await context.route("**/covers/**", (route) => route.abort());
    await context.route("**/_astro/**", (route) => route.abort());
    if (audio)
      await context.route(`**${new URL(audio, "http://x").pathname}`, (route) => route.abort());
    await page.goto(`/d/${AUDIO_ID}`);
    await expect(page.locator("#main")).toHaveAttribute("data-digest-id", AUDIO_ID);
    // The player wakes from the saved files too, and draws the 1024 cover the check below reads.
    await hydrated(page);
    // Every cover the page may show for this item (each theme, the player's 1024 included) answers
    // offline: a download once saved only the covers the page does not show.
    const covers = await page.evaluate(async (id) => {
      const urls = new Set<string>();
      for (const image of document.querySelectorAll<HTMLImageElement>(`img[srcset*="${id}"]`))
        for (const part of image.srcset.split(",")) urls.add(part.trim().split(/\s+/)[0] ?? "");
      const statuses = await Promise.all(
        [...urls].map((url) =>
          // Past the browser's HTTP cache, which a phone may have emptied: the worker must answer.
          fetch(url, { cache: "no-store" }).then(
            (res) => res.status,
            () => 0,
          ),
        ),
      );
      return [...urls].map((url, index) => `${statuses[index]} ${url}`);
    }, AUDIO_ID);
    expect(covers.some((line) => line.includes("1024"))).toBe(true);
    expect(covers.filter((line) => !line.startsWith("200 "))).toEqual([]);
    const answer = await page.evaluate(async (url) => {
      const res = await fetch(url, { headers: { Range: "bytes=10-19" } });
      return {
        status: res.status,
        range: res.headers.get("content-range"),
        size: (await res.arrayBuffer()).byteLength,
      };
    }, audio ?? "");
    expect(answer.status).toBe(206);
    expect(answer.range).toMatch(/^bytes 10-19\//);
    expect(answer.size).toBe(10);

    // Pressing Play offline plays the saved file: the chip is not shut for want of a connection
    // (it was, whatever the device held).
    const chip = page.locator("[data-play-digest]").first();
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await chip.click();
    await expect(chip).toHaveAttribute("data-playing", "true");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { played?: HTMLMediaElement }).played?.currentTime ?? 0,
        ),
      )
      .toBeGreaterThan(0.3);
    // The real audio is on another origin (the Blob host), where Chrome takes the worker's saved
    // copy of a no-cors file for the first read only: offline play stopped after a second. Here
    // the file is same-origin, so the request mode is what this journey can hold.
    expect(
      await page.evaluate(
        () => (window as unknown as { played?: HTMLMediaElement }).played?.crossOrigin,
      ),
    ).toBe("anonymous");
    await context.setOffline(false);
  });
});

const EPISODE_ID = "ep-20261007-1930";

test.describe("an episode download", () => {
  // The turn not stored yet is a 404 the page logs; it is the case under test.
  test.use({ allowNetworkErrors: true });

  test("a downloaded episode plays offline from its saved turns, and one with a turn not stored yet says so and saves nothing", async ({
    page,
    context,
  }) => {
    const turns = ["t0", "t1"].map((key) => ({
      key,
      item_id: null,
      characters: 10,
      audio: {
        url: `/audio/${EPISODE_ID}/seg/${key}.abc.mp3`,
        duration_ms: 1000,
        confirmed: false,
      },
    }));
    let missing = true;
    let offline = false;
    await context.route("**/api/narrate?digest=*", (route) =>
      offline
        ? route.abort()
        : route.fulfill({
            json: {
              status: 200,
              audio: null,
              timeline: null,
              segments: turns,
              ms_per_character: 50,
            },
          }),
    );
    await context.route("**/api/narrate-marks?*", (route) =>
      route.fulfill({ json: { words: [] } }),
    );
    await context.route("**/audio/*/seg/*.mp3", (route) =>
      missing && route.request().url().includes("t1")
        ? route.fulfill({ status: 404 })
        : route.fulfill({ body: Buffer.alloc(64, 1), contentType: "audio/mpeg" }),
    );
    await page.goto("/library");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");

    await openMenu(page, EPISODE_ID);
    await row(page, EPISODE_ID).getByRole("menuitem", { name: "Download" }).click();
    await expect(page.getByText("Not ready offline yet")).toBeVisible();
    await expect(row(page, EPISODE_ID)).not.toHaveAttribute("data-downloaded", "");

    missing = false;
    await page.reload();
    await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
    await openMenu(page, EPISODE_ID);
    await row(page, EPISODE_ID).getByRole("menuitem", { name: "Download" }).click();
    await expect(row(page, EPISODE_ID)).toHaveAttribute("data-downloaded", "");

    offline = true;
    await context.setOffline(true);
    await page.goto(`/e/${EPISODE_ID}`);
    const lookup = await page.evaluate(async (id) => {
      const res = await fetch(`/api/narrate?digest=${id}`);
      const body = await res.json();
      const file = await fetch(body.segments[1].audio.url, { headers: { Range: "bytes=0-9" } });
      return {
        confirmed: body.segments.every((s: { audio: { confirmed: boolean } }) => s.audio.confirmed),
        file: file.status,
      };
    }, EPISODE_ID);
    expect(lookup).toEqual({ confirmed: true, file: 206 });
    await context.setOffline(false);
  });
});

test("a phone's menu sheet shows a Close that closes it, a short pull springs back to the same box, a long pull or a tap outside closes it and focus returns to the dots", async ({
  page,
}) => {
  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }],
    });
  const pull = async (from: number, by: number) => {
    await touch("touchStart", from);
    for (let step = 1; step <= 6; step++) await touch("touchMove", from + (by * step) / 6);
    await touch("touchEnd", from + by);
  };
  const sheet = row(page, AUDIO_ID).locator(".menu-list");
  const dots = row(page, AUDIO_ID).locator("[data-hero-more]");

  await openMenu(page, AUDIO_ID);
  // The head carries a Close a finger can hit (D291): swipe, tap outside and the X all close the sheet.
  const close = sheet.locator("[data-menu-close]");
  expect(((await close.boundingBox()) ?? { width: 0 }).width).toBeGreaterThanOrEqual(40);
  // The sheet slides up when it opens: its rest box and its head are read, and the finger lands on
  // the head, only once the slide is over (a slow runner was still mid-slide).
  const settled = () =>
    sheet.evaluate((el) =>
      Promise.allSettled(el.getAnimations().map((animation) => animation.finished)),
    );
  await settled();
  const rest = await sheet.boundingBox();
  const head = (await sheet.locator(".sheet-head").boundingBox()) as { y: number };

  await pull(head.y + 8, 40);
  await expect.poll(() => sheet.boundingBox()).toEqual(rest);
  await expect(sheet).toBeVisible();
  // The spring-back runs on its own clock: the next finger waits for it, or lands above the head.
  await settled();

  await pull(head.y + 8, 200);
  await expect(sheet).toBeHidden();
  await expect(dots).toBeFocused();

  await openMenu(page, AUDIO_ID);
  await page.touchscreen.tap(195, 40);
  await expect(sheet).toBeHidden();

  await openMenu(page, AUDIO_ID);
  await close.click();
  await expect(sheet).toBeHidden();
  await expect(dots).toBeFocused();
});

test("a long press on a card opens its menu and leaves the card unopened, and is felt once", async ({
  page,
}) => {
  // The hold's own buzz went into the haptic tokens (D273): one `open`, not the old call and a second.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true });
    const felt: string[] = [];
    Object.assign(window, { felt });
    document.addEventListener("singularity:haptic", (event) =>
      felt.push((event as CustomEvent<string>).detail),
    );
    const heard: string[] = [];
    Object.assign(window, { heard });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        Object.assign(window, { context: this });
      }
    } as typeof AudioContext;
    document.addEventListener("singularity:cue", (event) =>
      heard.push((event as CustomEvent<string>).detail),
    );
  });
  // The click that ends a hold lands on the card's link: without a guard the page opens under the sheet.
  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  const menu = row(page, AUDIO_ID).locator(".menu-list");
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((done) => {
          let count = 0;
          const tick = () => (++count < 12 ? requestAnimationFrame(tick) : done());
          requestAnimationFrame(tick);
        }),
    );
  // A cue made before the sound engine has loaded is queued and never announced: a first gesture
  // starts it, and the cues are counted from there.
  const prime = async () => {
    await expect(async () => {
      await page.mouse.click(2, 2);
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { context?: AudioContext }).context?.state),
        )
        .toBe("running");
    }).toPass({ timeout: 10_000 });
    await page.evaluate(() => {
      const w = window as unknown as { heard: string[]; felt: string[] };
      w.heard.length = 0;
      w.felt.length = 0;
    });
  };
  // Counts closes, because the sheet opens again after one near the lift (below) and would hide them.
  await page.evaluate(() => {
    const w = window as unknown as { closes: number };
    w.closes = 0;
    document.addEventListener(
      "toggle",
      (event) => {
        if ((event as ToggleEvent).newState === "closed") w.closes += 1;
      },
      true,
    );
  });
  const release = await holdFinger(page, row(page, AUDIO_ID).locator(".card-title"));
  await expect(menu).toBeVisible();
  await release();
  // The lift is followed by mouse events within a few frames: the press would take focus from the
  // sheet, which closes it, and the click would open the card.
  await frames();
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { closes: number }).closes)).toBe(0);
  expect(new URL(page.url()).pathname).toBe("/library");
  expect(await page.evaluate(() => (window as unknown as { felt: string[] }).felt)).toEqual([
    "open",
  ]);

  // iPhone Safari closed the sheet at the lift (2026-10-31). A close just after a lift is the
  // hold's own, so the sheet opens again; Chromium never closes it, so the close is made here.
  await page.reload();
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  await prime();
  const again = await holdFinger(page, row(page, AUDIO_ID).locator(".card-title"));
  await expect(menu).toBeVisible();
  // The close is made by the page at the lift itself, as Safari's would be, so a slow runner cannot
  // push it past the grace.
  await menu.evaluate((list) =>
    document.addEventListener("pointerup", () => (list as HTMLElement).hidePopover(), {
      once: true,
    }),
  );
  // The iPhone's haptic tick is a click from script, made as the sheet opens: it must not end the hold.
  await page.evaluate(() => document.body.click());
  await again();
  await expect.poll(() => menu.evaluate((list) => list.matches(":popover-open"))).toBe(true);
  // The close and the reopen are one sheet staying open: heard and felt as one open, not a triple
  // (open, close, open) on the owner's phone (2026-11-01).
  await frames();
  const echoes = await page.evaluate(() => {
    const w = window as unknown as { heard: string[]; felt: string[] };
    return { heard: w.heard, felt: w.felt };
  });
  expect(echoes).toEqual({ heard: ["sheetOpen"], felt: ["open"] });

  // A tap outside right after a lift is the person closing it: it closes, stays closed (opened
  // again, it would jump back up as it left) and reaches nothing underneath.
  await page.reload();
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  const third = await holdFinger(page, row(page, AUDIO_ID).locator(".card-title"));
  await expect(menu).toBeVisible();
  await third();
  await page.touchscreen.tap(195, 40);
  await frames();
  await frames();
  expect(await menu.evaluate((list) => list.matches(":popover-open"))).toBe(false);
  // The tap lands on the app bar's Home link once the sheet is gone: it must not follow it.
  expect(new URL(page.url()).pathname).toBe("/library");
});

test("Settings > Downloads stays a list with a working ⋮ when reached from the Library, lists what was downloaded and removes it only after a confirm, for good", async ({
  page,
}) => {
  await page.goto("/library");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");
  await openMenu(page, AUDIO_ID);
  await row(page, AUDIO_ID).getByRole("menuitem", { name: "Download" }).click();
  await expect(row(page, AUDIO_ID)).toHaveAttribute("data-downloaded", "");

  // The page shows the saved podcast and none of the rest of the Library. It is reached from the
  // Library without a reload: the Library's script lives on and once set its stored view, the
  // gallery, on this page, which showed Downloads as cards with a ⋮ (owner, 2026-11-01).
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await page.getByRole("link", { name: "Downloads" }).click();
  await expect(page.locator("[data-downloads]")).toHaveAttribute("data-ready", "");
  await expect(page.locator("[data-card]:visible")).toHaveCount(1);
  await expect(row(page, AUDIO_ID)).toBeVisible();
  const cover = await row(page, AUDIO_ID).locator(".cover").boundingBox();
  const title = await row(page, AUDIO_ID).locator(".card-title").boundingBox();
  expect(title?.x).toBeGreaterThan((cover?.x ?? 0) + (cover?.width ?? 0));
  // Drawn and pressable, not only laid out: a phone hides the Library's ⋮ with opacity and pointer-events.
  const more = row(page, AUDIO_ID).locator(".card-more");
  await expect(more).toHaveCSS("opacity", "1");
  await expect(more).toHaveCSS("pointer-events", "auto");

  // Removing asks first: Cancel keeps it.
  const dialog = page.getByRole("dialog", { name: "Remove download?" });
  await openRowMenu(page, row(page, AUDIO_ID));
  await row(page, AUDIO_ID).getByRole("menuitem", { name: "Remove download" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row(page, AUDIO_ID)).toBeVisible();

  // Delete all, from the ⋮ at the title, asks first too.
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete all downloads" }).click();
  const all = page.getByRole("dialog", { name: "Delete all downloads?" });
  await all.getByRole("button", { name: "Cancel" }).click();
  await expect(row(page, AUDIO_ID)).toBeVisible();

  await openRowMenu(page, row(page, AUDIO_ID));
  await row(page, AUDIO_ID).getByRole("menuitem", { name: "Remove download" }).click();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No downloads", { exact: true }).last()).toBeVisible();

  // Gone after a reload too: the list is Cache Storage, not the page.
  await page.reload();
  await expect(page.locator("[data-downloads]")).toHaveAttribute("data-ready", "");
  await expect(page.locator("[data-card]:visible")).toHaveCount(0);
});
