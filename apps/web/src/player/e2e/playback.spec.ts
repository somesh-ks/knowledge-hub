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
    await expect(lab.mini).toHaveCSS("visibility", "hidden");
  });

  test("plays from the first tap, shows the mini player and updates the call to action", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await expect(lab.mini).toHaveAttribute("data-visible", "true");
    await expect(page.locator("[data-play-label]")).toHaveText("Pause");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(0.4);
    expect((await audio.read())?.paused).toBe(false);
  });

  test("pauses and resumes from the mini player", async ({ lab, audio, page }) => {
    await lab.open();
    await lab.play();
    await page.locator(".mini-btn[data-primary]").tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    expect((await audio.read())?.paused).toBe(true);
    await expect(page.locator("[data-play-label]")).toHaveText("Resume");
    await page.locator(".mini-btn[data-primary]").tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });

  test("marks the current item and fills the rail continuously inside it", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    const first = page.locator('[data-item-id="a1f3c9d2b401"]');
    await expect(first).toHaveAttribute("data-state", "current");
    await expect(page.locator(".briefing")).toHaveAttribute("data-live", "");
    const before = await lab.progressOf();
    await page.waitForTimeout(900);
    const after = await lab.progressOf();
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(0.3);
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
    await expect(third).toHaveAttribute("aria-label", /^Pause: /);
    await third.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(third).toHaveAttribute("aria-label", /^Listen from here: /);
  });

  test("plays a chapter from its header", async ({ lab, audio, page }) => {
    await lab.open();
    await page.locator('[data-chapter-play="ai"]').tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(60);
    await expect(page.locator('[data-chapter="ai"]')).toHaveAttribute("data-state", "current");
    await expect(page.locator('[data-chapter="top"]')).toHaveAttribute("data-state", "played");
  });

  test("seeks to the nearest item when the rail strip is tapped", async ({ lab, audio, page }) => {
    await lab.open();
    await lab.play();
    const target = page.locator('[data-item-id="d4a6f2c5e734"] .node');
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("node not found");
    const strip = await page.locator(".rail-hit").boundingBox();
    if (!strip) throw new Error("rail strip not found");
    await page.touchscreen.tap(strip.x + strip.width / 2, box.y + box.height / 2);
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(44);
    await expect(page.locator('[data-item-id="d4a6f2c5e734"]')).toHaveAttribute(
      "data-state",
      "current",
    );
  });

  test("changes speed with pitch preserved and remembers it", async ({ lab, audio, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByLabel("1.5x").check({ force: true });
    await expect.poll(async () => (await audio.read())?.playbackRate).toBe(1.5);
    expect((await audio.read())?.preservesPitch).toBe(true);
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(async () => (await audio.read())?.playbackRate).toBe(1.5);
  });

  test("moves by item and by fifteen seconds from the transport controls", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("button", { name: "Next item" }).tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(15);
    await page.getByRole("button", { name: "Forward 15 seconds" }).tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(30);
    await page.getByRole("button", { name: "Back 15 seconds" }).tap();
    await page.getByRole("button", { name: "Previous item" }).tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 99).toBeLessThan(16);
  });

  test("remembers the position and restores it after a reload", async ({ lab, audio, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("button", { name: "Forward 15 seconds" }).tap();
    await page.getByRole("button", { name: "Forward 15 seconds" }).tap();
    await expect.poll(async () => (await audio.read())?.currentTime ?? 0).toBeGreaterThan(29);
    await page.getByRole("button", { name: "Pause" }).first().tap();
    const saved = await page.evaluate(() => localStorage.getItem("dispatch:resume:2026-01-14"));
    expect(Number(saved)).toBeGreaterThan(29);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("[data-play-label]")).toHaveText("Resume");
    await expect(page.locator("[data-play-time]")).toContainText("0:3");
    await page.locator("[data-play-digest]").tap();
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
      artist: "Dispatch",
      album: "January 2026",
      artwork: ["512x512", "1024x1024"],
    });
    expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  });

  test("shows the designed state when the audio is still being prepared, and the page stays usable", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open("/dev/player-lab-preparing");
    await expect(page.locator("[data-play-label]")).toHaveText("Audio is still being prepared");
    await expect(lab.cta).toHaveAttribute("aria-disabled", "true");
    await lab.cta.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "idle");
    expect(await audio.count()).toBe(0);
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
    await expect(page.locator(".mini")).toHaveAttribute("data-visible", "true");
    await expect(page.locator("[data-play-label]")).toHaveText("Play the briefing");
    // Choosing the new digest switches the source and never plays two at once.
    await page.locator("[data-play-digest]").tap();
    await expect.poll(async () => (await audio.read())?.src ?? "").toContain("#older");
    expect(await audio.count()).toBe(1);
    await expect(page.locator("[data-item-id]").first()).toHaveAttribute("data-state", "current");
  });
});
