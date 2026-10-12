import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

/** Where a story ends in the page's recording, in seconds, from the page's own digest data. */
function storyEnd(page: Page, index: number): Promise<number> {
  return page.evaluate((at) => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items[at]?.end_ms ?? 0) / 1000;
  }, index);
}

/**
 * A story is marked played only when it was heard (D92): playing goes on out of it into the next.
 * The playhead is put just before the story's end and left to play on.
 */
async function playOnOutOf(page: Page, index: number): Promise<void> {
  const end = await storyEnd(page, index);
  await page.evaluate((seconds) => {
    window.__audios[0].currentTime = seconds;
  }, end - 0.6);
}

test.describe("playback in a real browser", () => {
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
    await expect(lab.cta).toHaveAccessibleName(/^Pause the briefing, \d+ min left$/);
  });

  test("a story chip keeps one size, so the publisher beside it never moves @surface", async ({
    lab,
    page,
  }) => {
    await lab.open();
    const story = page.locator(".story").first();
    const chip = story.locator("[data-play-item]");
    const source = story.locator(".story-source");
    const measure = async () => ({
      chip: (await chip.boundingBox())?.width,
      source: (await source.boundingBox())?.x,
    });
    const seen: Record<string, { chip?: number; source?: number }> = {};
    await expect(chip).toBeVisible();
    seen.idle = await measure();
    await lab.play();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
    seen.playing = await measure();
    await lab.dock.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Paused");
    seen.paused = await measure();
    // Played is earned by hearing the story out: from just before its end, play on into the next.
    await playOnOutOf(page, 0);
    await lab.dock.getByRole("button", { name: "Play", exact: true }).click();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Played");
    seen.played = await measure();
    const sources = new Set(Object.values(seen).map((s) => s.source));
    const widths = new Set(Object.values(seen).map((s) => s.chip));
    expect(sources.size, JSON.stringify(seen)).toBe(1);
    expect(widths.size, JSON.stringify(seen)).toBe(1);
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
    await expect(page.locator("[data-player-surface]")).toHaveAttribute("aria-modal", "true");
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
    await page.getByRole("button", { name: "Next story" }).tap();
    await expect.poll(time).toBeCloseTo(15, 0);
    await page.getByRole("button", { name: "Forward 10 seconds" }).tap();
    await expect.poll(time).toBeCloseTo(25, 0);
    await page.getByRole("button", { name: "Back 10 seconds" }).tap();
    await expect.poll(time).toBeCloseTo(15, 0);
    await page.getByRole("button", { name: "Forward 10 seconds" }).tap();
    await expect.poll(time).toBeCloseTo(25, 0);
    // Ten seconds into the second item: Previous restarts it.
    await page.getByRole("button", { name: "Previous story" }).tap();
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
    // It plays on from the kept place: from the top it could not pass it within the poll's 8 s.
    await expect
      .poll(async () => (await audio.read())?.currentTime ?? 0)
      .toBeGreaterThan(Number(saved));
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
});
