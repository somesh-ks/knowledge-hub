import { expect, test } from "./fixtures";

/** The briefing with an audio file: the only kind a row can download. */
const AUDIO_ID = "2026-10-07";
const row = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`[data-card][data-id="${id}"]`);

async function openMenu(page: import("@playwright/test").Page, id: string) {
  await row(page, id).locator("[data-hero-more]").click();
  await expect(row(page, id).locator(".hero-menu-list")).toBeVisible();
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
    document.addEventListener("dispatch:queue-add", (event) =>
      (window as unknown as { queued: string[] }).queued.push((event as CustomEvent).detail.id),
    );
  });
  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-menus-ready", "");

  await openMenu(page, AUDIO_ID);
  await row(page, AUDIO_ID).getByRole("menuitem", { name: "Share" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
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

test("a downloaded briefing opens offline and its audio is answered from the saved file, Range included", async ({
  page,
  context,
}) => {
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
  const audio = await row(page, AUDIO_ID).locator("[data-library-menu]").getAttribute("data-audio");

  await context.setOffline(true);
  await page.goto(`/d/${AUDIO_ID}`);
  await expect(page.locator("#main")).toHaveAttribute("data-digest-id", AUDIO_ID);
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
  await context.setOffline(false);
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
