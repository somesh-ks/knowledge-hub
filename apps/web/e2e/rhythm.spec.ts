import { expect, test } from "./fixtures";

/**
 * Switching destinations is instant, so a title that starts at a different height on each one reads
 * as a jump. The first block of every destination starts at the same distance under the top chrome,
 * and on a sub-page its title, which carries the way back, takes that place.
 */
const SIZES = [
  { width: 1280, height: 800, tag: ["@desktop"] },
  { width: 390, height: 844, tag: [] },
];

const DESTINATIONS = ["/", "/library", "/create", "/settings"];
const SUBPAGES = [
  "/settings/daily",
  "/settings/weekly",
  "/settings/model",
  "/settings/topics",
  "/settings/topics/audio_interfaces",
];

/** The top edge of a page's first block, measured from the top of <main>. */
async function firstBlockTop(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<number> {
  const block = page.locator(selector).first();
  await expect(block).toBeVisible();
  return block.evaluate((element) => {
    const main = document.querySelector("main");
    return element.getBoundingClientRect().top - (main?.getBoundingClientRect().top ?? 0);
  });
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, { tag: size.tag }, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the four destinations start their first block at one height", async ({ page }) => {
      const tops: Record<string, number> = {};
      for (const path of DESTINATIONS) {
        await page.goto(path);
        tops[path] = await firstBlockTop(page, "main .hero .cover, main h1");
      }
      const reference = tops["/"] ?? 0;
      expect(reference).toBeGreaterThan(0);
      for (const [path, top] of Object.entries(tops)) {
        expect(
          Math.abs(top - reference),
          `${path} starts at ${top}, Today at ${reference}`,
        ).toBeLessThanOrEqual(1);
      }
    });

    test("a sub-page puts its title where the destinations start", async ({ page }) => {
      await page.goto("/");
      const reference = await firstBlockTop(page, "main .hero .cover, main h1");
      for (const path of SUBPAGES) {
        await page.goto(path);
        const top = await firstBlockTop(page, "main .settings-head");
        expect(
          Math.abs(top - reference),
          `${path} starts at ${top}, Today at ${reference}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  });
}
