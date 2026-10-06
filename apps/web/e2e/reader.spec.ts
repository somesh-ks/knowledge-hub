import type { PlayerDigestData } from "../src/types/contracts";
import { toRgba } from "./colors";
import { AUDIO_DIGEST, expect, test } from "./fixtures";

test.describe("the reader page", () => {
  test("renders the date, the meta lines and the call to action", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".hero-meta")).toContainText("12 items since Monday");
    await expect(page.locator(".hero-meta")).toContainText("2 min to read, 4 to listen");
    const cta = page.locator(".cta[data-play-digest]");
    await expect(cta).toContainText("Play the briefing");
    await expect(cta).toContainText("0:36");
    await expect(cta).not.toHaveAttribute("aria-disabled", "true");
  });

  test("groups items into chapters in the fixed order", async ({ page }) => {
    await page.goto("/");
    const chapters = page.locator(".chapter-block");
    await expect(chapters).toHaveCount(6);
    await expect(chapters.locator("h2")).toHaveText([
      /Top picks/,
      /Interaction craft/,
      /AI models and products/,
      /Research/,
      /Launches/,
      /Watch and listen/,
    ]);
    await expect(page.locator(".item")).toHaveCount(12);
  });

  test("gives every item the attributes the player reads", async ({ page }) => {
    await page.goto("/");
    const items = page.locator(".item");
    for (let index = 0; index < 12; index += 1) {
      const item = items.nth(index);
      await expect(item).toHaveAttribute("data-index", String(index));
      await expect(item).toHaveAttribute("data-item-id", /^[0-9a-f]{12}$/);
    }
    await expect(page.locator(".item[data-lead]")).toHaveCount(1);
    await expect(items.first()).toHaveAttribute("data-lead", "");
    await expect(page.locator(".chapter-block").first()).toHaveAttribute("data-chapter", "top");
    await expect(page.locator(".briefing")).not.toHaveAttribute("data-live", /.*/);
    await expect(page.locator(".item[data-state]")).toHaveCount(0);
  });

  test("labels the play controls for assistive technology", async ({ page }) => {
    await page.goto("/");
    const first = page.locator(".item").first();
    await expect(first.locator(".item-play")).toHaveAttribute(
      "aria-label",
      /^Listen from here: Springlet 2\.0/,
    );
    await expect(first.locator(".item-play")).toHaveAttribute("data-play-item", "0");
    await expect(page.locator(".chapter-row").first()).toHaveAttribute(
      "aria-label",
      "Listen to Top picks, 0:09",
    );
    await expect(page.locator(".cta")).toHaveAttribute("data-play-digest", "2026-10-07");
  });

  test("renders each headline as a link to its source with the byline", async ({ page }) => {
    await page.goto("/");
    const first = page.locator(".item").first();
    const link = first.getByRole("link", { name: /Springlet 2\.0/ });
    await expect(link).toHaveAttribute("href", /^https:\/\/example\.com\//);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(first.locator(".item-byline")).toContainText("Springlet Blog");
    await expect(first.locator(".item-byline .sr-only")).toHaveText("by");
    await expect(first.locator(".item-why")).toContainText("Why Copy the retargeting pattern");
  });

  test("sets the digest id on the page and in the JSON the player reads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveAttribute("data-digest-id", "2026-10-07");
    await expect(page.locator("html")).toHaveAttribute("data-digest-id", "2026-10-07");
    const data = (await page.evaluate(() =>
      JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "null"),
    )) as PlayerDigestData;
    expect(data.id).toBe("2026-10-07");
    expect(data.title).toBe("Wednesday 7 October");
    expect(data.items).toHaveLength(12);
    expect(data.items[0]?.start_ms).toBe(0);
    expect(data.audio).toEqual({ url: "/fixtures/audio.wav", duration_ms: 36_000 });
    expect(data.timeline).toBe("marks");
    expect(data.sections.map((section) => section.slug)).toEqual([
      "top",
      "ui-craft",
      "ai",
      "research",
      "launches",
      "watch",
    ]);
    expect(data.cover.src512).toBe("/covers/2026-10-07-512.png");
    expect(data.cover.key).toMatch(/^#[0-9a-f]{6}$/);
    expect(data.prev_id).toBe("2026-10-05");
    expect(data.next_id).toBeNull();
    // The item ids in the data match the ids in the markup, in the same order.
    const ids = await page
      .locator(".item")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")));
    expect(data.items.map((item) => item.id)).toEqual(ids);
  });

  test("shows the same briefing at /d/<id> as at the home page", async ({ page }) => {
    await page.goto(AUDIO_DIGEST);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".item")).toHaveCount(12);
  });

  test("says why audio is unavailable instead of offering a dead button", async ({ page }) => {
    await page.goto("/d/2026-10-05");
    const cta = page.locator(".cta");
    await expect(cta).toHaveAttribute("aria-disabled", "true");
    await expect(cta).toContainText("Audio is still being prepared");
    await expect(cta).toHaveAccessibleDescription(/Narration is generated after the text/);
    await expect(page.locator(".item-play")).toHaveCount(0);
    await expect(page.locator(".rail-hit")).toHaveCount(0);
    await expect(page.locator(".chapter-row").first()).not.toHaveAttribute("data-play-item", /.*/);
    // The text is complete without audio.
    await expect(page.locator(".item")).toHaveCount(8);
  });

  test("a disabled call to action does nothing when pressed", async ({ page }) => {
    await page.goto("/d/2026-10-05");
    // Playwright will not click a disabled control; force it, as a finger would.
    await page.locator(".cta").click({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "idle");
  });

  test("marks the weekly deep dive in the list of earlier briefings", async ({ page }) => {
    await page.goto("/d/2026-10-05");
    await expect(page.locator(".archive-row", { hasText: "Weekly deep dive" })).toHaveCount(1);
    await expect(page.locator(".earlier .cover[data-weekly]")).toHaveCount(1);
  });

  test("is readable with JavaScript turned off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".item")).toHaveCount(12);
    await expect(page.getByRole("link", { name: /Springlet 2\.0/ })).toBeVisible();
    await context.close();
  });

  test("lists the earlier briefings and a way to all of them", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".earlier .archive-row")).toHaveCount(2);
    await expect(page.getByRole("link", { name: /All briefings/ })).toHaveAttribute(
      "href",
      "/archive",
    );
  });
});

test.describe("the page head", () => {
  test("carries the tags an installed iPhone app needs", async ({ page }) => {
    await page.goto("/");
    const head = page.locator("head");
    await expect(head.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    await expect(head.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(head.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      "content",
      "yes",
    );
    await expect(
      head.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute("content", "black-translucent");
    await expect(head.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(head.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    await expect(head.locator('meta[name="theme-color"]')).toHaveCount(2);
    await expect(head.locator('meta[name="theme-color"][media*="light"]')).toHaveAttribute(
      "content",
      "#f4f8fb",
    );
    await expect(head.locator('meta[name="theme-color"][media*="dark"]')).toHaveAttribute(
      "content",
      "#0a1119",
    );
    await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
  });

  test("uses an opaque background on the sticky header", async ({ page }) => {
    await page.goto("/");
    const header = await page.locator(".site-header").evaluate((node) => {
      const style = getComputedStyle(node);
      return { position: style.position, background: style.backgroundColor, top: style.top };
    });
    expect(header.position).toBe("sticky");
    expect(header.top).toBe("0px");
    // Opaque means an alpha of one, which Safari 26 needs to sample the status-bar tint.
    expect((await toRgba(page, header.background)).alpha).toBe(255);
    expect(header.background).not.toContain("/");
  });

  test("updates the title on every page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Wednesday 7 October, Dispatch");
    await page.goto("/archive");
    await expect(page).toHaveTitle("Archive, Dispatch");
  });
});
