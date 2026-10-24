import { expect, test } from "./fixtures";

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

  // A failed refetch left the last range's chart and breakdown under the failure, and offered a
  // table of them (audit, 2026-10-24). The next good answer must bring them back.
  test("nothing of the last range stays under a failed refetch, and the next answer draws again", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-22T10:00:00Z"));
    await page.goto("/analytics");
    const plot = page.locator("[data-costs-plot]");
    const breakdown = page.locator("[data-costs-rank]");
    const table = page.locator("[data-costs-table]");
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

    // Back to days, which the frozen report's buckets are.
    fail = false;
    await page.locator("#costs-range").selectOption("day");
    await expect(plot).toBeVisible();
    await expect(page.locator(".costs-mark")).toHaveCount(2);
    await expect(breakdown).toBeVisible();
    await expect(table).toBeVisible();
  });
});
