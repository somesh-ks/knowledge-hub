import { expect, hydrated, test } from "./fixtures";

/**
 * A day's two Catch ups are one album (D219): a select before Play moves between them, named by the
 * hour each was started in this browser's own zone. The two fixture episodes were made on
 * 2026-10-07 (03:00Z and 05:10Z).
 */
test.use({ timezoneId: "Asia/Kolkata" });

const FIRST = "ep-20261006-0900";
const SECOND = "ep-20261007-1930";

test("the select names each Catch up in the browser's zone and switching it moves nothing in the row", async ({
  page,
}) => {
  await page.goto(`/e/${FIRST}`);
  await hydrated(page);
  const pick = page.getByRole("combobox", { name: "Catch up" });
  // 03:00Z and 05:10Z are 08:30 and 10:40 in Delhi; the server drew Stockholm's 05 and 07.
  await expect(pick.locator("option")).toHaveText(["Catch up at 08", "Catch up at 10"]);
  await expect(pick).toHaveValue(FIRST);

  // Across the row, not down the page: a longer title on the other page moves the row down.
  const row = async () => {
    const across = (box: { x: number; width: number; height: number } | null) =>
      box && { x: box.x, width: box.width, height: box.height };
    return {
      chip: across(await page.locator(".hero-actions > .chip").boundingBox()),
      select: across(await pick.boundingBox()),
    };
  };
  const before = await row();

  await pick.selectOption(SECOND);
  await expect(page).toHaveURL(new RegExp(`/e/${SECOND}$`));
  await expect(pick).toHaveValue(SECOND);
  await expect(pick.locator("option")).toHaveText(["Catch up at 08", "Catch up at 10"]);
  // The same row, to the pixel: the other name did not push Play or the select aside.
  expect(await row()).toEqual(before);
});

test("a row too narrow for the select, Play and Share scrolls sideways instead of widening the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/e/${FIRST}`);
  await hydrated(page);
  const scrolls = await page.locator(".hero-actions").evaluate((row) => ({
    row: row.scrollWidth > row.clientWidth,
    page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(scrolls).toEqual({ row: true, page: false });
  // Share is reachable by scrolling to it.
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.scrollIntoViewIfNeeded();
  await expect(share).toBeInViewport({ ratio: 1 });
});
