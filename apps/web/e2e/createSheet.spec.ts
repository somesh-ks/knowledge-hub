import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { OPEN_PASSPHRASE } from "../src/lib/access";
import { expect, hydrated, test } from "./fixtures";

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
  test("the button or the floating button exists at this width, and the nav lists three", async ({
    page,
  }, info) => {
    // Below 64rem Create floats on the Library alone (D60).
    await page.goto("/library");
    const wide = info.project.name === "desktop";
    if (wide) {
      await expect(page.locator(".create-fab")).toBeHidden();
      await expect(page.locator(".app-nav-create")).toBeVisible();
      await expect(page.locator(".app-nav-create")).toHaveText("New episode");
      // Gmail's Compose: it hugs its words, 56px tall, and does not fill the column.
      const button = await page.locator(".app-nav-create").boundingBox();
      const column = await page.locator(".app-nav").boundingBox();
      expect(Math.round(button?.height ?? 0)).toBe(56);
      expect(button?.width ?? 0).toBeLessThan((column?.width ?? 0) - 40);
    } else {
      await expect(page.locator(".app-nav-create")).toBeHidden();
      await expect(page.getByRole("link", { name: "New episode" })).toBeVisible();
      // Extended at the top of the page, the plus and the word; folded to a 56px square while
      // scrolling down to read (D52).
      const fab = page.locator(".create-fab");
      await expect(fab).toContainText("New episode");
      expect(Math.round((await fab.boundingBox())?.width ?? 0)).toBeGreaterThan(56);
      // The Library is short on a phone, so the steps are too: the first scroll loads the script
      // that folds the button and the second, with room left to scroll, folds it.
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(150);
      await page.mouse.wheel(0, 160);
      await expect(fab).toHaveAttribute("data-folded", "");
      await expect.poll(async () => Math.round((await fab.boundingBox())?.width ?? 0)).toBe(56);
      await page.mouse.wheel(0, -400);
      await expect(fab).not.toHaveAttribute("data-folded", "");
    }
    await expect(page.locator(".app-nav-item")).toHaveText(["Today", "Library", "Settings"]);
  });

  test("opens the sheet, Escape closes it and focus returns to the button", async ({ page }) => {
    await openSheet(page);
    await expect(sheet(page).getByRole("heading", { name: "New episode" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(trigger(page)).toBeFocused();
  });

  test("the button sits at the foot of the sheet even when the form is short", async ({ page }) => {
    await openSheet(page);
    await expect(sheet(page).locator("[data-create-more]")).not.toHaveAttribute("open", "");
    // Measured once the sheet has slid in and laid out.
    await expect
      .poll(() =>
        sheet(page).evaluate((dialog) => {
          const foot = dialog.querySelector(".create-submit") as HTMLElement;
          return Math.round(
            dialog.getBoundingClientRect().bottom - foot.getBoundingClientRect().bottom,
          );
        }),
      )
      .toBe(0);
  });

  test("Close is at the start of the full-screen sheet and at the end of the side sheet", async ({
    page,
  }, info) => {
    await openSheet(page);
    const close = await sheet(page).locator("[data-create-close]").boundingBox();
    const title = await sheet(page).locator(".sheet-title").boundingBox();
    if (!close || !title) throw new Error("the header is not laid out");
    if (info.project.name === "desktop") expect(close.x).toBeGreaterThan(title.x + title.width);
    else expect(close.x + close.width).toBeLessThanOrEqual(title.x);
  });

  test("in the side sheet every control ends at the same right edge", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the side sheet is for wide screens");
    await openSheet(page, "/");
    await sheet(page).getByText("More options").click();
    const rights = await sheet(page)
      .locator(".create-choice, .create-select > select, .create-title")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .map((node) => Math.round(node.getBoundingClientRect().right)),
      );
    expect(rights.length).toBeGreaterThanOrEqual(6);
    expect(new Set(rights).size).toBe(1);
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
    await expect(page.getByRole("dialog", { name: "Enter the passphrase" })).toBeHidden();
    await expect(title).toHaveValue("My week in AI");
  });

  test("a press that starts inside the panel and ends outside it keeps the panel open", async ({
    page,
  }, info) => {
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
  });

  test("browser Back closes the sheet and stays on the page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".app-nav-item", { hasText: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await trigger(page).click();
    await expect(sheet(page)).toBeVisible();
    await page.goBack();
    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\/library$/);
    await expect(trigger(page)).toBeFocused();
  });

  test("the floating button never overlaps the player bar's controls", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "the floating button is for phones");
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
      passphrase: OPEN_PASSPHRASE,
      request: {
        audience: "custom",
        topic_ids: ["design", "ui-craft", "ai", "tech"],
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
    await page.locator(".app-nav-item", { hasText: "Today" }).click();
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

test.describe("Try again on a failed run", () => {
  // The refused request is logged by the browser as a failed load; here it is the point.
  test.use({ allowNetworkErrors: true });

  test("a Try again that cannot be sent opens the sheet again, filled in with the request", async ({
    page,
  }) => {
    await mockRun(page, [{ run_id: 31, state: "completed", step: null, outcome: "failed" }]);
    await openSheet(page);
    const chosen = (name: string) =>
      sheet(page).locator(".filter-chip", { hasText: name }).locator("input");
    await sheet(page).locator(".settings-segment", { hasText: "10 min" }).click();
    await sheet(page).locator(".filter-chip", { hasText: "Design" }).click();
    await expect(chosen("Design")).not.toBeChecked();
    await sheet(page).locator("[data-submit]").click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator("[data-run-text]")).toHaveText("Couldn't make the episode", {
      timeout: 15_000,
    });
    // The passphrase is refused this time: the request cannot go from the line, so the form it
    // came from opens again with every choice in it.
    await page.unroute("**/api/podcast");
    await page.route("**/api/podcast", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
    );
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('input[name="length"][value="10"]')).toBeChecked();
    await expect(chosen("Design")).not.toBeChecked();
    await expect(chosen("Technology")).toBeChecked();
  });
});
