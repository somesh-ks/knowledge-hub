import { expect, test } from "./fixtures";

/**
 * Switching destinations is instant, so a title that starts at a different height on each one reads
 * as a jump. The first block of every destination starts at the same distance under the top chrome,
 * and on a sub-page the back link takes that place.
 */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];

const DESTINATIONS = ["/", "/library", "/create", "/settings"];
const SUBPAGES = ["/settings/daily", "/settings/podcast/topics"];

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
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

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

    test("a sub-page puts its back link where the destinations start", async ({ page }) => {
      await page.goto("/");
      const reference = await firstBlockTop(page, "main .hero .cover, main h1");
      for (const path of SUBPAGES) {
        await page.goto(path);
        const top = await firstBlockTop(page, "main .manage-back");
        expect(
          Math.abs(top - reference),
          `${path} starts at ${top}, Today at ${reference}`,
        ).toBeLessThanOrEqual(1);
      }
    });
  });
}
