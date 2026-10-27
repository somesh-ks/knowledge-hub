import type { Page } from "@playwright/test";
import { expect, expectNoViolationsInEitherScheme, hydrated, test } from "./fixtures";

const trigger = (page: Page) => page.locator("[data-create-open]:visible").first();
const sheet = (page: Page) => page.locator("dialog.create-sheet");

async function openSheet(page: Page, path = "/library"): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  await trigger(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator("[data-create]")).toHaveAttribute("data-ready", "");
}

async function mockRun(page: Page, states: unknown[]): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/podcast", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: 202, run_id: 31, started_at: "x" }),
    });
  });
  let asked = 0;
  await page.route("**/api/status?**", async (route) => {
    const next = states[Math.min(asked, states.length - 1)];
    asked += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(next),
    });
  });
  return bodies;
}

test.describe("Create as the primary action", () => {
  test("opens the sheet, Escape closes it and focus returns to the button", async ({ page }) => {
    await openSheet(page);
    await expect(sheet(page).getByRole("heading", { name: "Catch up" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  });

  test("Enter in the title puts the keyboard away and sends nothing", async ({ page }) => {
    const bodies = await mockRun(page, [{ run_id: 31, state: "running", step: null }]);
    await openSheet(page);
    await sheet(page).getByText("More options").click();
    const title = sheet(page).getByRole("textbox", { name: /^Title/ });
    await title.fill("My week in AI");
    await title.press("Enter");
    await expect(title).not.toBeFocused();
    // Long enough for a request to have gone out, had Enter submitted the form.
    await page.waitForTimeout(500);
    expect(bodies).toEqual([]);
    await expect(sheet(page)).toBeVisible();
    await expect(title).toHaveValue("My week in AI");
  });

  test(
    "a press that starts inside the panel and ends outside it keeps the panel open",
    { tag: "@both" },
    async ({ page }, info) => {
      await openSheet(page);
      const head = await sheet(page).locator(".create-sheet-head").boundingBox();
      const chip = sheet(page).locator(".filter-chip:visible").first();
      await chip.scrollIntoViewIfNeeded();
      const box = await chip.boundingBox();
      if (!head || !box) throw new Error("the panel is not laid out");
      // Pressed on a chip, released on the header: the click lands on the dialog itself.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(head.x + head.width / 3, head.y + head.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await expect(sheet(page)).toBeVisible();
      // A press on the scrim beside the side panel still closes it.
      if (info.project.name === "desktop") {
        await page.mouse.click(head.x / 2, head.y + 200);
        await expect(sheet(page)).toBeHidden();
      }
    },
  );

  test("browser Back closes the sheet and stays on the page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".app-nav-item", { hasText: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await hydrated(page);
    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();
    await page.goBack();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\/library$/);
    await expect(trigger(page)).toBeFocused();
  });

  test("the floating button never overlaps the player bar's controls", async ({ page }) => {
    await page.goto("/");
    // Until the player has hydrated, a press on the play chip is lost.
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-mini", "visible");
    // Create floats on the Library, where the bar keeps playing.
    await page.locator(".app-nav-item", { hasText: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-mini", "visible");
    await page.waitForTimeout(500);
    const fab = await page.locator(".create-fab").boundingBox();
    const controls = await page
      .locator(".player-dock button")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getBoundingClientRect())
          .map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })),
      );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const apart =
        (fab?.y ?? 0) + (fab?.height ?? 0) <= control.top ||
        (fab?.x ?? 0) + (fab?.width ?? 0) <= control.left ||
        (fab?.x ?? 0) >= control.right ||
        (fab?.y ?? 0) >= control.bottom;
      expect(apart).toBe(true);
    }
  });

  test("submitting posts the same body, closes the sheet and shows the indicator, which survives navigation and a reload", async ({
    page,
  }) => {
    const bodies = await mockRun(page, [
      { run_id: 31, state: "running", step: null },
      { run_id: 31, state: "completed", step: null, outcome: "published" },
    ]);
    await openSheet(page);
    await sheet(page).locator("[data-submit]").click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({
      request: {
        audience: "custom",
        topic_ids: ["ai", "design", "ui-craft", "software", "tech"],
        length_minutes: 5,
        format: "readout",
        window_days: 7,
        tone: "neutral",
        voice_id: null,
      },
    });
    await expect(sheet(page)).toBeHidden();
    // The status region holds the line alone, not the card's link and buttons.
    const status = page.locator("[data-run-status]").getByRole("status");
    await expect(status).toContainText(/Episode queued|Writing your episode/);

    // A client-side navigation keeps it, and a reload picks the run up again.
    await page.locator(".app-nav-item", { hasText: "Latest" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await expect(page.locator("[data-run-text]")).toHaveText("Episode ready", { timeout: 15_000 });
    // From Today the line offers a link to the Library; on the Library, the page on screen, none.
    await expect(page.getByRole("link", { name: "Open Library" })).toHaveAttribute(
      "href",
      "/library",
    );
    await page.locator(".app-nav-item", { hasText: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("[data-run-library]")).toBeHidden();
  });

  test("axe finds nothing with the sheet open", async ({ page }) => {
    await openSheet(page);
    await expectNoViolationsInEitherScheme(page);
  });
});
