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
