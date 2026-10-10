import { expect, test } from "./lab";

test.describe("keyboard operation of the player", () => {
  test("the scrubber seeks 5 seconds with arrows and 15 with shift", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await lab.dialog.getByRole("button", { name: "Pause" }).press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    const scrubber = page.getByRole("slider", { name: "Playback position" });
    await scrubber.focus();
    const start = (await audio.read())?.currentTime ?? 0;
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeCloseTo(start + 5, 0);
    await page.keyboard.press("Shift+ArrowRight");
    await expect
      .poll(async () => (await audio.read())?.currentTime ?? 0)
      .toBeCloseTo(start + 20, 0);
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await audio.read())?.currentTime ?? 0)
      .toBeCloseTo(start + 15, 0);
  });

  test("the page keys move by item and Home and End jump to the ends", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const scrubber = page.getByRole("slider", { name: "Playback position" });
    await scrubber.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(15);
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(30);
    await page.keyboard.press("PageUp");
    await expect
      .poll(async () => {
        const time = (await audio.read())?.currentTime ?? 0;
        return time >= 15 && time < 20;
      })
      .toBe(true);
    await page.keyboard.press("End");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "ended");
    await page.keyboard.press("Home");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 99).toBeLessThan(1);
  });

  test("announces the position to a screen reader through the slider's value text", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const scrubber = page.getByRole("slider", { name: "Playback position" });
    await expect(scrubber).toHaveAttribute("aria-valuemin", "0");
    await expect(scrubber).toHaveAttribute("aria-valuemax", "90");
    await expect(scrubber).toHaveAttribute(
      "aria-valuetext",
      /^\d+:\d\d of 1:30, Top picks, item 1 of 6$/,
    );
    await scrubber.focus();
    await page.keyboard.press("PageDown");
    await expect(scrubber).toHaveAttribute("aria-valuetext", /Top picks, item 2 of 6$/);
  });

  test("K and Space toggle playback only while focus is inside the open player", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("slider", { name: "Playback position" }).focus();
    await page.keyboard.press("k");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    // On a button, Space activates the button instead.
    await page.getByRole("button", { name: "Next item" }).focus();
    const before = await page.locator(".player-meta .player-story").textContent();
    await page.keyboard.press("Space");
    await expect(page.locator(".player-meta .player-story")).not.toHaveText(before ?? "");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });

  test("a bare Space does nothing until the player has something loaded", async ({ lab, page }) => {
    await lab.open();
    await page.locator("body").press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "idle");
    await page.keyboard.press("k");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "idle");
  });

  test("Space plays and pauses from anywhere on the page once the bar is there @surface", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 120);
    });
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.locator("body").press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    // It acted, so the page did not scroll with it.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test("Space leaves typing, controls, held keys, modifiers and other dialogs alone @surface", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.id = "probe-field";
      const editable = document.createElement("div");
      editable.id = "probe-editable";
      editable.contentEditable = "true";
      editable.tabIndex = 0;
      const slider = document.createElement("div");
      slider.id = "probe-slider";
      slider.setAttribute("role", "slider");
      slider.tabIndex = 0;
      document.body.append(field, editable, slider);
    });
    const playing = (): Promise<void> =>
      expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    for (const selector of ["#probe-field", "#probe-editable", "#probe-slider"]) {
      await page.locator(selector).focus();
      await page.keyboard.press("Space");
    }
    await page.keyboard.press("Control+Space");
    await playing();
    await page.getByRole("link").first().focus();
    await page.keyboard.press("Space");
    await playing();
    // A dialog that is not the player.
    await page.evaluate(() => {
      const dialog = document.createElement("dialog");
      dialog.id = "probe-dialog";
      dialog.append(document.createTextNode("Hello"));
      document.body.append(dialog);
      dialog.show();
    });
    await page.locator("body").press("Space");
    await playing();
    await page.evaluate(() => document.getElementById("probe-dialog")?.remove());
    await page.locator("body").press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
  });

  test("tabs through the header, the briefing and the bar in reading order", async ({
    lab,
    page,
  }) => {
    await lab.open();
    const labels: string[] = [];
    for (let press = 0; press < 3; press += 1) {
      await page.keyboard.press("Tab");
      labels.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          return element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? "";
        }),
      );
    }
    expect(labels).toEqual(["Dispatch", "Generate", "Settings"]);
    await lab.play();
    const region = page.getByRole("region", { name: "Audio player" });
    await expect(region.getByRole("button")).toHaveCount(3);
    await region.getByRole("button", { name: /^Player: / }).focus();
    await page.keyboard.press("Tab");
    await expect(region.getByRole("button", { name: "Pause" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(region.getByRole("button", { name: "Next item" })).toBeFocused();
  });
});
