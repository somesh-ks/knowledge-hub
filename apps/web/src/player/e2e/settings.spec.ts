import { expect, test } from "./lab";

async function openSettings(page: import("@playwright/test").Page) {
  await page.locator('[data-open-sheet="settings"]').tap();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("the Settings sheet", () => {
  test("changes the theme, remembers it and applies it before the next paint", async ({
    lab,
    page,
  }) => {
    await lab.open();
    const dialog = await openSettings(page);
    await dialog.getByLabel("Dark").check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // The change crossfades through a view transition, during which the page takes no input.
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("dispatch:preferences") ?? "{}").theme,
      ),
    ).toBe("dark");
    await dialog.getByLabel("Light").check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.waitForTimeout(500);
    await dialog.getByLabel("System").check({ force: true });
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await page.waitForTimeout(500);
    await dialog.getByLabel("Dark").check({ force: true });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("turns interface sounds off and on, and disables the volume while off", async ({
    lab,
    page,
  }) => {
    await lab.open();
    const dialog = await openSettings(page);
    const toggle = dialog.getByRole("switch", { name: "Interface sounds" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("dispatch:preferences") ?? "{}").sounds,
      ),
    ).toBe(false);
    await expect(dialog.getByRole("slider", { name: "Volume" })).toBeDisabled();
    await toggle.click();
    await expect(dialog.getByRole("slider", { name: "Volume" })).toBeEnabled();
  });

  test("sets the volume from the keyboard and persists it", async ({ lab, page }) => {
    await lab.open();
    const dialog = await openSettings(page);
    const volume = dialog.getByRole("slider", { name: "Volume" });
    await volume.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("dispatch:preferences") ?? "{}").volume,
        ),
      )
      .toBeCloseTo(0.7, 2);
  });

  test("shares the default speed with the player", async ({ lab, audio, page }) => {
    await lab.open();
    const dialog = await openSettings(page);
    await dialog.getByLabel("1.5x").check({ force: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await lab.play();
    await expect.poll(async () => (await audio.read())?.playbackRate).toBe(1.5);
    await lab.openPlayer();
    await expect(lab.dialog.getByRole("button", { name: /^Speed / })).toHaveText("1.5x");
  });

  test("starts with interface sounds off for people who ask for reduced motion", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/dev/player-lab", { waitUntil: "networkidle" });
    await page.locator('[data-open-sheet="settings"]').tap();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog.getByRole("switch", { name: "Interface sounds" })).not.toBeChecked();
    await context.close();
  });

  test("shows the Add to Home Screen hint only in Safari on iOS after two visits, and forgets it for good once hidden", async ({
    browser,
  }) => {
    const safari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: safari,
    });
    const page = await context.newPage();
    await page.goto("/dev/player-lab", { waitUntil: "networkidle" });
    await page.locator('[data-open-sheet="settings"]').tap();
    const first = page.getByRole("dialog", { name: "Settings" });
    await expect(first).toBeVisible();
    await expect(first.getByText("Add Singularity to your Home Screen")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-open-sheet="settings"]').tap();
    const second = page.getByRole("dialog", { name: "Settings" });
    await expect(second.getByText("Add Singularity to your Home Screen")).toBeVisible();
    await expect(second.getByText(/Add to Home Screen/).first()).toBeVisible();
    expect(await second.innerText()).not.toMatch(/install/i);
    await second.getByRole("button", { name: "Hide this" }).tap();
    await expect(second.getByText("Add Singularity to your Home Screen")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-open-sheet="settings"]').tap();
    await expect(
      page
        .getByRole("dialog", { name: "Settings" })
        .getByText("Add Singularity to your Home Screen"),
    ).toHaveCount(0);
    await context.close();
  });

  test("never shows the hint in other browsers", async ({ lab, page }) => {
    await lab.open();
    await page.reload({ waitUntil: "networkidle" });
    const dialog = await openSettings(page);
    await expect(dialog.getByText("Add Singularity to your Home Screen")).toHaveCount(0);
  });
});
