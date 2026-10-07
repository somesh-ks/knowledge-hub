import { expect, test } from "./fixtures";

test.describe("the archive", () => {
  test("lists briefings by year and month, newest first, with weekly dives marked", async ({
    page,
  }) => {
    await page.goto("/archive");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Archive");
    await expect(page.locator(".archive-lede")).toHaveText(
      "3 briefings, newest first. Weekly deep dives are marked.",
    );
    const year = page.locator(".year-group");
    await expect(year).toHaveCount(1);
    await expect(year).toHaveAttribute("open", "");
    await expect(year.locator("summary").first()).toContainText("2026");
    const month = page.locator(".month-group");
    await expect(month).toHaveAttribute("open", "");
    await expect(month.locator("summary")).toContainText("October");
    await expect(month.locator("summary")).toContainText("3 briefings");
    const rows = month.locator(".archive-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Wednesday 7 October");
    await expect(rows.nth(1)).toContainText("Monday 5 October");
    await expect(rows.nth(2)).toContainText("Sunday 4 October");
    await expect(rows.nth(2)).toContainText("Weekly deep dive");
    await expect(rows.nth(0)).toContainText("12 items, 4 min");
  });

  test("opens a briefing from a row", async ({ page }) => {
    await page.goto("/archive");
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
  });

  test("collapses and expands a month with the keyboard", async ({ page }) => {
    await page.goto("/archive");
    const summary = page.locator(".month-group > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".month-group")).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(page.locator(".month-group")).toHaveAttribute("open", "");
  });

  test("has a Today link that leads home, for an installed app with no browser back", async ({
    page,
  }) => {
    await page.goto("/archive");
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  });
});

test.describe("navigating without reloading", () => {
  test("moves between the reader and the archive on the client", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __kept: string }).__kept = "same document";
    });
    await expect(page.locator("html")).toHaveAttribute("data-view", "home");
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Archive");
    await expect(page.locator("html")).toHaveAttribute("data-view", "archive");
    // No full page load happened: the window is the same one.
    expect(await page.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
      "same document",
    );
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-view", "home");
    expect(await page.evaluate(() => (window as unknown as { __kept?: string }).__kept)).toBe(
      "same document",
    );
  });

  test("moves focus to the new heading and updates the title", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveTitle("Archive, Singularity");
    await expect(page.locator("main h1")).toBeFocused();
  });

  test("keeps the page at the top of the new route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /All briefings/ }).scrollIntoViewIfNeeded();
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Archive");
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
  });

  test("works with the browser back button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  });

  test("marks only the archive hop for animation", async ({ page }) => {
    await page.goto("/");
    const marks: string[] = [];
    await page.exposeFunction("recordMark", (value: string) => marks.push(value));
    await page.evaluate(() => {
      // The shell's listener was registered first, so it has set the attribute by the time this runs.
      document.addEventListener("astro:before-preparation", () => {
        (window as unknown as { recordMark: (value: string) => void }).recordMark(
          document.documentElement.getAttribute("data-astro-nav") ?? "none",
        );
      });
    });
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await page.getByRole("link", { name: /All briefings/ }).click();
    await expect(page).toHaveURL(/\/archive$/);
    expect(marks).toEqual(["none", "archive"]);
  });
});
