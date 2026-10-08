import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSPHRASE_REQUIRED } from "./passphrase";

const SENT = PASSPHRASE_REQUIRED ? "correct horse battery staple" : "open";

const trigger = (page: Page) => page.locator("[data-create-open]:visible").first();
const sheet = (page: Page) => page.locator("dialog.create-sheet");

async function openSheet(page: Page, path = "/"): Promise<void> {
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
  test("the button or the floating button exists at this width, and the nav lists three", async ({
    page,
  }, info) => {
    await page.goto("/");
    const wide = info.project.name === "desktop";
    if (wide) {
      await expect(page.locator(".create-fab")).toBeHidden();
      await expect(page.locator(".app-nav-create")).toBeVisible();
      await expect(page.locator(".app-nav-create")).toHaveText("Create");
    } else {
      await expect(page.locator(".app-nav-create")).toBeHidden();
      await expect(page.getByRole("link", { name: "Create a podcast" })).toBeVisible();
      const box = await page.locator(".create-fab").boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(56);
    }
    await expect(page.locator(".app-nav-item")).toHaveText(["Today", "Library", "Settings"]);
  });

  test("opens the sheet, Escape closes it and focus returns to the button", async ({ page }) => {
    await openSheet(page);
    await expect(sheet(page).getByRole("heading", { name: "Create a podcast" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  });

  test("the floating button never overlaps the player bar's controls", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "the floating button is for phones");
    await page.goto("/");
    await page.locator("[data-play-digest]").click();
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
    await sheet(page).locator(".create-chip:visible", { hasText: "Trending" }).click();
    await sheet(page).locator("[data-submit]").click();
    if (PASSPHRASE_REQUIRED) {
      const ask = page.getByRole("dialog", { name: "Enter the passphrase" });
      await ask.getByLabel("Passphrase").fill(SENT);
      await ask.getByRole("button", { name: "Create episode" }).click();
    }
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({
      passphrase: SENT,
      request: {
        audience: "custom",
        topic_ids: ["trending"],
        length_minutes: 5,
        format: "readout",
        window_days: 7,
        tone: "neutral",
      },
    });
    await expect(sheet(page)).toBeHidden();
    const status = page.getByRole("status").filter({ has: page.locator("[data-run-card]") });
    await expect(status).toContainText(/Waiting to start|Writing your episode/);

    // A client-side navigation keeps it, and a reload picks the run up again.
    await page.locator(".app-nav-item", { hasText: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await expect(page.locator("[data-run-text]")).toHaveText("Episode ready", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Open Library" })).toHaveAttribute(
      "href",
      "/library",
    );
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing with the sheet open, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openSheet(page);
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
