import { expect, test } from "./fixtures";

/**
 * The Costs page draws from /api/costs, whose report is split by the chosen breakdown. A total read
 * as estimated only while the split was by provider (2026-10-22): switching to "By use" lost the
 * providers, and the label changed with it. The label holds across every split.
 */
const report = (by: string) => {
  const day = (date: string, usd: number, split: Record<string, number>) => ({
    bucket: date,
    total: { usd, runs: 1, shared_usd: 0 },
    groups: Object.fromEntries(
      Object.entries(split).map(([key, value]) => [key, { usd: value, runs: 1, shared_usd: 0 }]),
    ),
  });
  const byProvider = by === "provider";
  return {
    time_zone: "Europe/Stockholm",
    prices_as_of: "2026-10-01",
    unconfirmed: ["speechify/*"],
    site: "ok",
    report: {
      buckets: [
        day("2026-10-18", 0.6, byProvider ? { anthropic: 0.4, speechify: 0.2 } : { daily: 0.6 }),
        day("2026-10-20", 0.3, byProvider ? { speechify: 0.3 } : { narration_on_play: 0.3 }),
      ],
      total: { usd: 0.9, runs: 2, shared_usd: 0 },
      per_run_usd: 0.45,
      per_user_usd: 0.9,
      users: 1,
    },
  };
};

test("the total keeps its label across every breakdown, and the chart and breakdown follow the split", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-22T10:00:00Z"));
  await page.route("**/api/costs**", (route) => {
    const by = new URL(route.request().url()).searchParams.get("by") ?? "provider";
    return route.fulfill({ json: report(by) });
  });
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
