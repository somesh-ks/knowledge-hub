import type { Page } from "@playwright/test";
import { expect, hydrated, seedStorage, test } from "./fixtures";

const panel = (page: Page) => page.getByRole("dialog", { name: "Generations" });
const trigger = (page: Page) => page.locator("[data-gen-trigger]");
const rows = (page: Page) => panel(page).locator("[data-gen]");

const row = (run_id: number, over: Record<string, unknown> = {}) => ({
  run_id,
  what: "episode",
  state: "running",
  started_at: new Date().toISOString(),
  stage: 1,
  stages: 6,
  label: "Writing the script",
  ...over,
});

/** The routes the list talks to: GET /api/generations (the rows it is given) and POST /api/cancel. */
async function mock(
  page: Page,
  generations: () => unknown[],
  cancel: { status: number } = { status: 202 },
): Promise<Array<Record<string, unknown>>> {
  const cancelled: Array<Record<string, unknown>> = [];
  await page.route("**/api/generations", (route) =>
    route.fulfill({ status: 200, json: { generations: generations() } }),
  );
  await page.route("**/api/cancel", async (route) => {
    cancelled.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: cancel.status, json: { run_id: cancelled.length } });
  });
  return cancelled;
}

// The 2026-10-28 owner ask: one place to follow every generation under way, a Catch up's and a
// Regenerate's alike, like a browser's downloads list: a thumbnail, a bar, the time left, Cancel.
test.describe("the generations list", () => {
  test("@desktop with nothing under way it says so and starts a Catch up", async ({ page }) => {
    await mock(page, () => []);
    await page.goto("/library");
    await hydrated(page);
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByText("Nothing in the works")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await panel(page).getByRole("link", { name: "Catch up" }).click();
    await expect(page.locator("dialog.create-sheet")).toBeVisible();
    await expect(panel(page)).toBeHidden();
  });

  test("@desktop Cancel stops one generation and leaves the other running", async ({ page }) => {
    const cancelled = await mock(page, () => [
      row(41),
      row(42, { what: "briefing", label: "Writing the briefing" }),
    ]);
    await page.goto("/library");
    await hydrated(page);
    await trigger(page).click();
    await expect(rows(page)).toHaveCount(2);

    await rows(page)
      .first()
      .getByRole("button", { name: /^Cancel/ })
      .click();
    await expect.poll(() => cancelled.length).toBe(1);
    expect(cancelled[0]).toEqual({ run_id: 41 });
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("data-gen", "42");
  });

  test.describe("when GitHub refuses", () => {
    // The browser logs the 503 on the page's behalf; the page takes it as a refusal, not a fault.
    test.use({ allowNetworkErrors: true });

    test("@desktop a Cancel that fails keeps the row and says why", async ({ page }) => {
      const cancelled = await mock(page, () => [row(41)], { status: 503 });
      await page.goto("/library");
      await hydrated(page);
      await trigger(page).click();
      await expect(rows(page)).toHaveCount(1);

      await rows(page)
        .first()
        .getByRole("button", { name: /^Cancel/ })
        .click();
      await expect.poll(() => cancelled.length).toBe(1);
      await expect(panel(page).getByText("Couldn't cancel. Try again.")).toBeVisible();
      await expect(rows(page)).toHaveCount(1);
    });
  });

  test("a run that is going opens the same list from the strip above the navigation", async ({
    page,
  }) => {
    const cancelled = await mock(page, () => [row(41)]);
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          run_id: 41,
          state: "running",
          step: null,
          stage: 1,
          stages: 3,
          label: "Making the episode",
        },
      }),
    );
    await seedStorage(page, {
      local: {
        "singularity:run": JSON.stringify({ id: 41, phase: "running", t0: Date.now() }),
      },
    });
    await page.goto("/library");
    await hydrated(page);
    const card = page.locator("[data-run-card]");
    await expect(card).toBeVisible();
    await card.click();
    await card.getByRole("button", { name: "All generations" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);

    await rows(page)
      .first()
      .getByRole("button", { name: /^Cancel/ })
      .click();
    await expect.poll(() => cancelled.length).toBe(1);
    expect(cancelled[0]).toEqual({ run_id: 41 });
  });

  test("a run that was cancelled ends as Cancelled, with nothing to try again", async ({
    page,
  }) => {
    await mock(page, () => []);
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        json: { run_id: 41, state: "completed", step: null, outcome: "cancelled" },
      }),
    );
    await seedStorage(page, {
      local: {
        "singularity:run": JSON.stringify({ id: 41, phase: "running", t0: Date.now() }),
      },
    });
    await page.goto("/library");
    await hydrated(page);
    await expect(page.locator("[data-run-text]")).toHaveText("Cancelled", { timeout: 15_000 });
    await expect(
      page.locator("[data-run-card]").getByRole("button", { name: "Try again" }),
    ).toBeHidden();
  });
});
