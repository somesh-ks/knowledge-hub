import { expect, test } from "./lab";

test.describe("playback in a real browser", () => {
  test("keeps the audio object out of the DOM and attaches the source before the first tap", async ({
    lab,
    audio,
  }) => {
    await lab.open();
    const snapshot = await audio.read();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.src).toContain("lab-narration.mp3");
    expect(snapshot?.paused).toBe(true);
    expect(snapshot?.inDom).toBe(false);
    expect(await audio.count()).toBe(1);
    // The bar is in the document from the start, and out of sight and reach until the first play.
    await expect(lab.page.locator("[data-player-dock]")).toHaveCSS("visibility", "hidden");
  });

  test("plays from the first tap, shows the bar and turns the briefing chip to Playing", async ({
    lab,
    audio,
  }) => {
    await lab.open();
    await lab.play();
    await expect(lab.surface).toHaveAttribute("data-visible", "true");
    await expect(lab.openButton).toBeVisible();
    await expect(lab.cta).toHaveAttribute("data-state", "current");
    await expect(lab.cta).toHaveAttribute("data-playing", "true");
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText("Playing");
    await expect(lab.cta).toHaveAccessibleName("Pause the briefing, playing");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(0.4);
    expect((await audio.read())?.paused).toBe(false);
  });

  test("pauses and resumes from the bar", async ({ lab, audio, page }) => {
    await lab.open();
    await lab.play();
    await lab.dock.getByRole("button", { name: "Pause" }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    expect((await audio.read())?.paused).toBe(true);
    // Paused, the chip offers the minutes that are left, and its name says what a press does.
    await expect(lab.cta).toHaveAttribute("data-state", "current");
    await expect(lab.cta).toHaveAttribute("data-playing", "false");
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText(/^\d+ min left$/);
    await expect(lab.cta).toHaveAccessibleName(/^Resume the briefing, \d+ min left$/);
    await lab.dock.getByRole("button", { name: "Play", exact: true }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText("Playing");
  });

  test("marks the current story, and the story chips follow the playhead", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    const first = page.locator('[data-item-id="a1f3c9d2b401"]');
    const second = page.locator('[data-item-id="b2e4d0a3c512"]');
    const firstChip = first.locator("[data-play-item]");
    await expect(first).toHaveAttribute("data-state", "current");
    await expect(firstChip).toHaveAttribute("data-state", "current");
    await expect(firstChip.locator("[data-chip-label]")).toHaveText("Playing");
    // Only the story being read is marked; the ones after it keep the page's own idle chip.
    await expect(second).not.toHaveAttribute("data-state", /.*/);
    await expect(second.locator("[data-play-item]")).toHaveAttribute("data-state", "idle");
    await expect(second.locator("[data-chip-label]")).toHaveText("0:15");
    // The bar moves to the next story: the one before is played, the one now reading takes over.
    await page.getByRole("button", { name: "Next item" }).tap();
    await expect(second).toHaveAttribute("data-state", "current");
    await expect(second.locator("[data-chip-label]")).toHaveText("Playing");
    await expect(first).toHaveAttribute("data-state", "played");
    await expect(firstChip).toHaveAttribute("data-state", "played");
    await expect(firstChip.locator("[data-chip-label]")).toHaveText("Played");
    await expect(firstChip).toHaveAccessibleName(/^Play again, played: /);
  });

  test("plays an item from its button, and toggles it with the same button", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    const third = page.locator('[data-item-id="c3f5e1b4d623"] [data-play-item]');
    await third.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(30);
    await expect(page.locator('[data-item-id="c3f5e1b4d623"]')).toHaveAttribute(
      "data-state",
      "current",
    );
    await expect(page.locator('[data-item-id="a1f3c9d2b401"]')).toHaveAttribute(
      "data-state",
      "played",
    );
    await expect(third).toHaveAttribute("data-playing", "true");
    await expect(third.locator("[data-chip-label]")).toHaveText("Playing");
    await expect(third).toHaveAttribute("aria-label", /^Pause, playing: /);
    await third.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(third.locator("[data-chip-label]")).toHaveText("Paused");
    await expect(third).toHaveAttribute("aria-label", /^Resume, paused: /);
  });

  test("plays a section from its control, by the hook the player listens for", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    // The reader pages have no section control today; the player still answers one when a page
    // adds it, so the hook is checked with a control written onto the page here.
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Play the AI section";
      button.dataset.playChapter = "ai";
      button.id = "lab-play-section";
      document.querySelector("main")?.append(button);
    });
    await page.locator("#lab-play-section").tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(60);
    await expect(page.locator('[data-item-id="e5b7a3d6f845"]')).toHaveAttribute(
      "data-state",
      "current",
    );
    await expect(page.locator('[data-item-id="a1f3c9d2b401"]')).toHaveAttribute(
      "data-state",
      "played",
    );
  });

  test("jumps to another story when its chip is tapped while playing", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    const fourth = page.locator('[data-item-id="d4a6f2c5e734"]');
    await fourth.locator("[data-play-item]").tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(44);
    await expect(fourth).toHaveAttribute("data-state", "current");
    await expect(fourth.locator("[data-chip-label]")).toHaveText("Playing");
    await expect(page.locator('[data-item-id="c3f5e1b4d623"]')).toHaveAttribute(
      "data-state",
      "played",
    );
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });

  test("picks a common speed in one press, with pitch preserved, and remembers it @surface", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const speed = lab.dialog.getByRole("button", { name: /^Playback speed / });
    await expect(speed).toHaveText("1x");
    // One press opens the panel: the slider, and the common speeds one more press away.
    await lab.finger.press(speed);
    const panel = page.getByRole("dialog", { name: "Playback speed" });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("slider", { name: "Playback speed" })).toBeFocused();
    await expect(panel.getByRole("button")).toHaveText(["1x", "1.25x", "1.5x", "2x"]);
    await expect(panel.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "true");
    await lab.finger.press(panel.getByRole("button", { name: "1.5x" }));
    await expect(panel.getByRole("button", { name: "1.5x" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(speed).toHaveText("1.5x");
    await expect(speed).toHaveAccessibleName("Playback speed 1.5x");
    await expect.poll(async () => (await audio.read())?.playbackRate).toBe(1.5);
    expect((await audio.read())?.preservesPitch).toBe(true);
    // Around it is its backdrop, so a press there closes it and reaches nothing underneath.
    const corner = { x: 8, y: 8 };
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("speed-panel"),
        corner,
      ),
    ).toBe(true);
    await lab.finger.pressAt(corner);
    await expect(panel).toBeHidden();
    await expect(speed).toBeFocused();
    await expect(lab.root).toHaveAttribute("data-player", "open");
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(async () => (await audio.read())?.playbackRate).toBe(1.5);
  });

  test("the speed panel works from the keyboard, and Escape closes only the panel @surface", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const speed = lab.dialog.getByRole("button", { name: /^Playback speed / });
    await speed.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Playback speed" });
    const slider = page.getByRole("slider", { name: "Playback speed" });
    await expect(slider).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(speed).toHaveText("1.05x");
    // Tab stays inside the panel and reaches the common speeds.
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "1x" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(speed).toHaveText("1x");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(speed).toBeFocused();
    // The player behind it is still open.
    await expect(lab.sheet).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Enter");
    await expect(slider).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Escape");
    await expect(speed).toHaveText("2x");
  });

  test("moves by item, back ten seconds and forward ten from the transport controls", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const time = async (): Promise<number> => (await audio.read())?.currentTime ?? 0;
    await lab.dialog.getByRole("button", { name: "Pause" }).tap();
    await page.getByRole("button", { name: "Next item" }).tap();
    await expect.poll(time).toBeCloseTo(15, 0);
    await page.getByRole("button", { name: "Forward 10 seconds" }).tap();
    await expect.poll(time).toBeCloseTo(25, 0);
    await page.getByRole("button", { name: "Back 10 seconds" }).tap();
    await expect.poll(time).toBeCloseTo(15, 0);
    await page.getByRole("button", { name: "Forward 10 seconds" }).tap();
    await expect.poll(time).toBeCloseTo(25, 0);
    // Ten seconds into the second item: Previous restarts it.
    await page.getByRole("button", { name: "Previous item" }).tap();
    await expect.poll(time).toBeCloseTo(15, 0);
    // The numerals are drawn by the buttons, over plain arrows.
    await expect(page.getByRole("button", { name: "Back 10 seconds" })).toHaveText("10");
    await expect(page.getByRole("button", { name: "Forward 10 seconds" })).toHaveText("10");
  });

  test("remembers the position and restores it after a reload", async ({ lab, audio, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("button", { name: "Forward 10 seconds" }).tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(9);
    await lab.dialog.getByRole("button", { name: "Pause" }).tap();
    const saved = await page.evaluate(() => localStorage.getItem("dispatch:resume:2026-01-14"));
    expect(Number(saved)).toBeGreaterThan(9);
    await page.reload({ waitUntil: "networkidle" });
    // Nothing is loaded yet, but the chip offers the place that was kept: a minute is left.
    await expect(lab.cta).toHaveAttribute("data-state", "idle");
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText(/^[12] min left$/);
    await expect(lab.cta).toHaveAccessibleName(/^Resume the briefing, [12] min left$/);
    await lab.cta.tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(29);
  });

  test("sets the lock-screen metadata from the digest", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    const metadata = await page.evaluate(() => {
      const meta = navigator.mediaSession.metadata;
      return meta
        ? {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            artwork: meta.artwork.map((a) => a.sizes),
          }
        : null;
    });
    expect(metadata).toEqual({
      title: "Wednesday 14 January",
      artist: "Singularity",
      album: "January 2026",
      artwork: ["512x512", "1024x1024"],
    });
    expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  });

  test("offers to make the audio when it is not there yet, and the page stays usable", async ({
    lab,
    audio,
    page,
  }) => {
    // Pressing play looks for the narration; here the server has none to offer.
    let asked = 0;
    await page.route("**/api/narrate?digest=*", (route) => {
      asked += 1;
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await lab.open("/dev/player-lab-preparing");
    await expect(page.locator(".hero-hint")).toHaveCount(0);
    await expect(lab.cta).toHaveAttribute("data-state", "idle");
    await expect(lab.cta).not.toHaveAttribute("aria-disabled", "true");
    // There is nothing to play from yet, so the stories carry no play chips.
    await expect(page.locator("[data-play-item]").first()).toBeHidden();
    await lab.cta.tap();
    await expect.poll(() => asked).toBe(1);
    await expect(page.getByText("Narration is not available right now.")).toBeVisible();
    // Nothing started: the player is idle, the element is paused, and the chip is as it was.
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "idle");
    expect((await audio.read())?.paused).toBe(true);
    await expect(lab.cta).toHaveAttribute("data-state", "idle");
    await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
  });

  test("keeps playing across a client-side navigation, and plays another digest only when asked", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(0.5);
    await page.getByRole("link", { name: "Earlier briefing, with audio" }).tap();
    await expect(page).toHaveURL(/player-lab-older/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 12 January");
    // The same audio object is still playing the first digest.
    expect(await audio.count()).toBe(1);
    const afterNavigation = await audio.read();
    expect(afterNavigation?.paused).toBe(false);
    expect(afterNavigation?.src).not.toContain("#older");
    await expect(lab.surface).toHaveAttribute("data-visible", "true");
    await expect(lab.cta).toHaveAttribute("data-state", "idle");
    await expect(lab.cta).toHaveAccessibleName("Play the briefing, 2 min");
    // Choosing the new digest switches the source and never plays two at once.
    await page.locator("[data-play-digest]").tap();
    await expect.poll(async () => (await audio.read())?.src ?? "").toContain("#older");
    expect(await audio.count()).toBe(1);
    await expect(page.locator("[data-item-id]").first()).toHaveAttribute("data-state", "current");
  });
});
