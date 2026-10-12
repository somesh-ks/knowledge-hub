import { expect, test } from "./helpers";

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
