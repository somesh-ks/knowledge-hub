import { costsReport, expect, test } from "./fixtures";

/**
 * The Costs page draws from /api/costs (the frozen report in fixtures.ts), whose report is split by
 * the chosen breakdown. A total read as estimated only while the split was by provider (2026-10-22):
 * switching to "By use" lost the providers, and the label changed with it. The label holds across
 * every split.
 */
test("the total keeps its label across every breakdown, and the chart and breakdown follow the split", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-22T10:00:00Z"));
  await page.goto("/analytics");
  const label = page.locator("[data-costs-label]");
  const breakdown = page.locator("[data-costs-rank] > li");
  await expect(breakdown).toHaveCount(2);
  const byProvider = await label.textContent();
  const first = await breakdown.first().textContent();
  await expect(page.locator(".costs-mark")).toHaveCount(2);

  await page.locator("#costs-by").selectOption("kind");
  await expect(breakdown.first()).not.toHaveText(first ?? "");
  await expect(label).toHaveText(byProvider ?? "");
});

test.describe("when the costs cannot be fetched", () => {
  test.use({ allowNetworkErrors: true });

  // A failed refetch left the last range's chart and breakdown under the failure, and still offered
  // the switch to a table of them (audit, 2026-10-24). The next good answer must bring them back.
  test("nothing of the last range stays under a failed refetch, and the next answer draws again", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-22T10:00:00Z"));
    await page.goto("/analytics");
    const plot = page.locator("[data-costs-plot]");
    const breakdown = page.locator("[data-costs-rank]");
    const table = page.locator("[data-costs-table]");
    const views = page.locator("[data-costs-view]");
    await expect(page.locator(".costs-mark")).toHaveCount(2);

    let fail = true;
    await page.route("**/api/costs**", (route) =>
      fail ? route.fulfill({ status: 500, body: "{}" }) : route.fallback(),
    );
    const failed = page.waitForResponse((response) => response.status() === 500);
    await page.locator("#costs-range").selectOption("week");
    await failed;
    await expect(plot).toBeHidden();
    await expect(breakdown).toBeHidden();
    await expect(table).toBeHidden();
    await expect(views).toBeHidden();

    // Back to days, which the frozen report's buckets are.
    fail = false;
    await page.locator("#costs-range").selectOption("day");
    await expect(plot).toBeVisible();
    await expect(page.locator(".costs-mark")).toHaveCount(2);
    await expect(breakdown).toBeVisible();
    await expect(views).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Five providers make the table wider than a phone's card. Scrolled to its end, the period column
  // left the screen, so "$0.04" was read without its day (design audit, 2026-10-24): the dates stay
  // at the scroller's start, and the edge fade begins past them.
  test("the table's dates stay in view, whole, scrolled to its end", async ({ page }) => {
    const split = { anthropic: 2.26, speechify: 0.11, exa: 0.12, firecrawl: 0.04, gemini: 0.02 };
    const groups = Object.fromEntries(
      Object.entries(split).map(([key, usd]) => [key, { usd, runs: 1, shared_usd: 0 }]),
    );
    const base = costsReport("provider");
    await page.clock.setFixedTime(new Date("2026-10-22T10:00:00Z"));
    await page.route("**/api/costs**", (route) =>
      route.fulfill({
        json: {
          ...base,
          report: {
            ...base.report,
            buckets: [{ bucket: "2026-10-20", total: { usd: 2.55, runs: 1, shared_usd: 0 }, groups }],
            total: { usd: 2.55, runs: 1, shared_usd: 0 },
          },
        },
      }),
    );
    await page.goto("/analytics");
    await expect(page.locator(".costs-mark")).toHaveCount(1);
    await page.locator("#costs-view-table").click();
    const scroller = page.locator("[data-costs-table-scroll]");
    await expect(scroller).toHaveAttribute("tabindex", "0");
    const boxes = await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      const date = element.querySelector("tbody tr > :first-child");
      const words = document.createRange();
      if (date) words.selectNodeContents(date);
      const inset = Number.parseFloat(element.style.getPropertyValue("--scroll-fade-inset")) || 0;
      const edge = element.getBoundingClientRect().left;
      return {
        scrolled: element.scrollLeft,
        edge,
        date: date?.getBoundingClientRect().left ?? Number.NaN,
        wordsEnd: words.getBoundingClientRect().right,
        fadeBegins: edge + inset,
      };
    });
    expect(boxes.scrolled).toBeGreaterThan(0);
    expect(boxes.date).toBeCloseTo(boxes.edge, 0);
    // The mask is opaque up to the inset: the date's words end before the fade begins.
    expect(boxes.wordsEnd).toBeLessThanOrEqual(boxes.fadeBegins);
  });
});
