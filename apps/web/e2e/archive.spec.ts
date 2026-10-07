import { expect, test } from "./fixtures";

test.describe("the archive", () => {
  test("lists briefings under their month, newest first, with weekly dives marked", async ({
    page,
  }) => {
    await page.goto("/archive");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Archive");
    await expect(page.locator(".page-head .meta")).toHaveText("3 briefings, newest first");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["October 2026"]);
    const rows = page.locator(".archive-month .archive-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.locator(".archive-date")).toHaveText([
      "Wednesday 7 October",
      "Monday 5 October",
      "Sunday 4 October",
    ]);
    // The recording's own length where there is one, the estimate written with the text elsewhere.
    await expect(rows.nth(0).locator(".meta > span")).toHaveText(["12 stories", "1 min"]);
    await expect(rows.nth(1).locator(".meta > span")).toHaveText(["8 stories", "3 min"]);
    await expect(rows.nth(2).locator(".meta > span")).toHaveText([
      "14 stories",
      "8 min",
      "Weekly deep dive",
    ]);
    await expect(rows.nth(2).locator(".cover[data-weekly]")).toHaveCount(1);
    // A plain grouped list: nothing to open or close.
    await expect(page.locator("details, summary")).toHaveCount(0);
  });

  test("opens a briefing from a row", async ({ page }) => {
    await page.goto("/archive");
    await page.getByRole("link", { name: /Monday 5 October/ }).click();
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
  });

  test("the whole row is the link, out to the edge of the screen", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Edge to edge is a phone layout");
    await page.goto("/archive");
    const row = await page.locator(".archive-list > li").nth(1).boundingBox();
    // A tap in the gutter, beside the cover, still opens the briefing.
    await page.mouse.click(4, (row?.y ?? 0) + (row?.height ?? 0) / 2);
    await expect(page).toHaveURL(/\/d\/2026-10-05$/);
    await page.goBack();
    // And one in the row's own padding, just under its top hairline.
    const again = await page.locator(".archive-list > li").nth(2).boundingBox();
    await page.mouse.click(200, (again?.y ?? 0) + 3);
    await expect(page).toHaveURL(/\/d\/2026-10-04-weekly$/);
  });

  test("divides rows with hairlines that run edge to edge", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Edge to edge is a phone layout");
    await page.goto("/archive");
    const rule = await page
      .locator(".archive-list > li")
      .nth(1)
      .evaluate((node) => {
        const style = getComputedStyle(node, "::before");
        return {
          left: node.getBoundingClientRect().left + Number.parseFloat(style.left),
          width: Number.parseFloat(style.width),
        };
      });
    expect(rule.left).toBeCloseTo(0, 0);
    expect(rule.width).toBeCloseTo(390, 0);
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

  test("marks each navigation with the move it makes", async ({ page }) => {
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
    expect(marks).toEqual(["in", "out"]);
  });
});
