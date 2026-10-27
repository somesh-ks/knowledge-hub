import { expect, SITE, test } from "./helpers";

const SITE_PAGE = `**${SITE.path}`;

test("one surface: the page waits collapsed and out of reach, then opens as one modal dialog with the bar @desktop", async ({
  player,
  page,
  finger,
}) => {
  await player.open();
  await expect(player.surface).toHaveCount(1);
  await expect(player.surface).toHaveAttribute("data-state", "collapsed");
  await expect(player.sheet).toHaveAttribute("inert", "");
  await expect(player.sheet).toBeHidden();
  await player.play();
  await expect(player.openButton).toHaveAttribute("aria-expanded", "false");
  const controls = await player.openButton.getAttribute("aria-controls");
  expect(controls).toBeTruthy();
  await expect(player.sheet).toHaveAttribute("id", controls ?? "");
  await player.openPlayer();
  // By attribute: on a phone the bar is out of the accessibility tree while the page is open.
  await expect(page.locator("[data-player-open]")).toHaveAttribute("aria-expanded", "true");
  // One modal dialog holds the page and the bar, so a screen reader that honours aria-modal
  // still reaches the bar's controls.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator("[data-player-page]")).toHaveCount(1);
  await expect(dialog.locator("[data-player-dock]")).toHaveCount(1);
  const mouseWide = await page.evaluate(
    () => matchMedia("(min-width: 64rem) and (hover: hover) and (pointer: fine)").matches,
  );
  if (!mouseWide) return;
  // With a mouse on a wide screen the bar keeps its whole transport under the open page: Pause is on
  // screen once, in the bar, and the page holds only what the bar has not, the skips with the speed
  // between them. The keyboard's Close button is the one close control, and the bar's open button
  // closes the page it opened.
  await expect(dialog.getByRole("button", { name: "Close the player" })).toHaveCount(1);
  await expect(player.dock.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const page_ = dialog.locator("[data-player-page]");
  await expect(page_.getByRole("button", { name: "Pause", exact: true })).toBeHidden();
  await expect(page_.getByRole("button", { name: "Back 10 seconds" })).toBeVisible();
  await expect(page_.getByRole("button", { name: /^Playback speed / })).toBeVisible();
  await finger.press(player.openButton);
  await player.collapsed();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// The bar's controls read high (2026-10-27): they were centred in the bar's box, but the progress
// line is drawn over its top edge, so the part that shows is centred lower. Each control, play and the
// wide bar's expand chevron included, sits on the middle of the bar below that line. Within half a
// pixel, because the error was one pixel.
test("the bar's controls sit in the middle of what shows of the bar @desktop", async ({
  player,
}) => {
  await player.open();
  await player.play();
  const bar = await player.boxOf(player.dock);
  const line = await player.boxOf(player.dock.locator(".dock-progress"));
  const middle = (line.y + line.height + bar.y + bar.height) / 2;
  const controls = player.dock.locator(".dock-transport .dock-btn, .dock-tools button");
  const names: string[] = [];
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await player.boxOf(control);
    names.push((await control.getAttribute("aria-label")) ?? "");
    expect(Math.abs(box.y + box.height / 2 - middle), names.at(-1)).toBeLessThan(0.5);
  }
  expect(names).toContain("Pause");
});

// A catch-up episode that arrives with no script yet showed a page of empty room. With no transcript
// and no queue the page is the cover and its controls alone (D-lean, 2026-10-25); a queued item
// brings the list. The cover keeps its row, size and, below 64rem, its place when that happens.
test("the cover holds still when a queue arrives on a page with nothing to read @desktop", async ({
  player,
  page,
}) => {
  await page.route(SITE_PAGE, async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      /(<script[^>]*id="singularity-digest-data"[^>]*>)([\s\S]*?)(<\/script>)/,
      (_all, open: string, json: string, close: string) => {
        const data = JSON.parse(json);
        return `${open}${JSON.stringify({ ...data, items: [], sections: [], turns: undefined })}${close}`;
      },
    );
    await route.fulfill({ response, body: html });
  });
  await player.open();
  await player.play();
  await player.openPlayer();
  const cover = player.dialog.locator(".player-cover-box");
  await expect(player.dialog.locator(".player-page-inner")).toHaveAttribute("data-lean", "");
  const before = await cover.boundingBox();
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("singularity:queue-add", { detail: { id: "ep-20261007-1930" } }),
    );
  });
  await expect(player.dialog.locator(".player-page-inner")).not.toHaveAttribute("data-lean", "");
  await player.settled();
  const after = await cover.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.height).toBe(before?.height);
  expect(after?.y).toBe(before?.y);
  // Stacked, the cover is centred either way. Side by side it moves to the left column.
  const stacked = await page.evaluate(() => matchMedia("(width < 64rem)").matches);
  if (stacked) expect(after?.x).toBe(before?.x);
});
