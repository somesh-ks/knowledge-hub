import type { Page } from "@playwright/test";
import { expect, type PlayerPage, test } from "./helpers";

/**
 * A story is marked played only when it was heard (D92): playing goes on out of it into the next.
 * The playhead is put just before the story's end and left to play on.
 */
async function playOnOutOf(player: PlayerPage, index: number): Promise<void> {
  const end = (await player.stories())[index]?.end ?? 0;
  await player.page.evaluate((seconds) => {
    const element = window.__audios[0];
    if (element) element.currentTime = seconds;
  }, end - 0.6);
}

const time = async (page: Page): Promise<number> =>
  page.evaluate(() => window.__audios[0]?.currentTime ?? 0);

test.describe("playback on a briefing", () => {
  test("pauses and resumes from the bar @smoke", async ({ player, audio, page }) => {
    await player.open();
    await player.play();
    await player.finger.press(player.dock.getByRole("button", { name: "Pause" }));
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    expect((await audio.read())?.paused).toBe(true);
    // Paused, the chip offers the minutes that are left, and its name says what a press does.
    await expect(player.cta).toHaveAttribute("data-state", "current");
    await expect(player.cta).toHaveAttribute("data-playing", "false");
    await expect(player.cta.locator("[data-chip-label]")).toHaveText(/^\d+ min left$/);
    await expect(player.cta).toHaveAccessibleName(/^Resume the briefing, \d+ min left$/);
    await player.finger.press(player.dock.getByRole("button", { name: "Play", exact: true }));
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(player.cta).toHaveAccessibleName(/^Pause the briefing, \d+ min left$/);
  });

  test("a story chip keeps one size, so the publisher beside it never moves", async ({
    player,
    page,
  }) => {
    await player.open();
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
    await player.play();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Playing");
    seen.playing = await measure();
    await player.dock.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Paused");
    seen.paused = await measure();
    // Played is earned by hearing the story out: from just before its end, play on into the next.
    await playOnOutOf(player, 0);
    await player.dock.getByRole("button", { name: "Play", exact: true }).click();
    await expect(chip.locator("[data-chip-label]")).toHaveText("Played");
    seen.played = await measure();
    const sources = new Set(Object.values(seen).map((s) => s.source));
    const widths = new Set(Object.values(seen).map((s) => s.chip));
    expect(sources.size, JSON.stringify(seen)).toBe(1);
    expect(widths.size, JSON.stringify(seen)).toBe(1);
  });

  test("speed: from the keyboard, then a common speed in one press, kept over a reload @desktop", async ({
    player,
    audio,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    const speed = player.dialog.getByRole("button", { name: /^Playback speed / });
    const panel = page.getByRole("dialog", { name: "Playback speed" });
    const slider = page.getByRole("slider", { name: "Playback speed" });
    await expect(speed).toHaveAccessibleName("Playback speed 1x");
    // The owner saw the controls shake as the speed changed (2026-10-11, 2026-10-18): the label
    // changed its length, so it slid inside its pill and moved the skips either side. The skips and
    // the label's own text keep their boxes whatever the speed reads.
    // Found by role and name, so the guard holds whatever the controls' markup becomes.
    const steady = [
      player.dialog.getByRole("button", { name: /^Back \d+ seconds$/ }),
      player.dialog.getByRole("button", { name: /^Forward \d+ seconds$/ }),
    ];
    const boxes = async () => [
      ...(await Promise.all(
        steady.map(async (control) => {
          const box = await control.boundingBox();
          return `${box?.x.toFixed(1)},${box?.width.toFixed(1)}`;
        }),
      )),
      // The label's own text: the box around it held while the words inside it slid.
      await speed.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        return `${box.x.toFixed(1)},${box.width.toFixed(1)}`;
      }),
    ];
    const atOne = await boxes();
    // The keyboard: Enter opens the panel on its slider, Tab stays inside, Escape closes only it.
    await speed.focus();
    await page.keyboard.press("Enter");
    await expect(slider).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(speed).toHaveAccessibleName("Playback speed 1.05x");
    expect(await boxes()).toEqual(atOne);
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "1x" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(speed).toHaveAccessibleName("Playback speed 1x");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(speed).toBeFocused();
    await expect(page.locator("[data-player-surface]")).toHaveAttribute("aria-modal", "true");
    // A press: the slider, and the common speeds one more press away.
    await player.finger.press(speed);
    await expect(panel).toBeVisible();
    await expect(slider).toBeFocused();
    await expect(panel.getByRole("button")).toHaveText(["1x", "1.25x", "1.5x", "2x"]);
    await expect(panel.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "true");
    await player.finger.press(panel.getByRole("button", { name: "1.5x" }));
    await expect(panel.getByRole("button", { name: "1.5x" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    await player.finger.pressAt(corner);
    await expect(panel).toBeHidden();
    await expect(speed).toBeFocused();
    await expect(player.root).toHaveAttribute("data-player", "open");
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(async () => (await audio.read())?.playbackRate).toBe(1.5);
  });

  test("moves by story, back ten seconds and forward ten from the transport controls", async ({
    player,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    const stories = await player.stories();
    const press = (name: string) =>
      player.finger.press(player.dialog.getByRole("button", { name, exact: true }));
    await press("Pause");
    await press("Next story");
    const second = stories[1]?.start ?? 0;
    await expect.poll(() => time(page)).toBeCloseTo(second, 0);
    await press("Forward 10 seconds");
    await expect.poll(() => time(page)).toBeCloseTo(second + 10, 0);
    await press("Back 10 seconds");
    await expect.poll(() => time(page)).toBeCloseTo(second, 0);
    await press("Forward 10 seconds");
    await expect.poll(() => time(page)).toBeCloseTo(second + 10, 0);
    // Early in a story, Previous goes to the start of the one before it.
    const at = stories.findIndex((story) => second + 10 >= story.start && second + 10 < story.end);
    await press("Previous story");
    await expect.poll(() => time(page)).toBeCloseTo(stories[at - 1]?.start ?? -1, 0);
  });

  test("remembers the position and restores it after a reload", async ({ player, page }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    await player.finger.press(player.dialog.getByRole("button", { name: "Forward 10 seconds" }));
    await expect.poll(() => time(page)).toBeGreaterThan(9);
    await player.finger.press(player.dialog.getByRole("button", { name: "Pause", exact: true }));
    const saved = Number(
      await page.evaluate(() => localStorage.getItem("dispatch:resume:2026-10-07")),
    );
    expect(saved).toBeGreaterThan(9);
    await page.reload({ waitUntil: "networkidle" });
    // Nothing is loaded yet, but the chip offers the place that was kept.
    await expect(player.cta).toHaveAttribute("data-state", "idle");
    await expect(player.cta.locator("[data-chip-label]")).toHaveText(/^\d+ min left$/);
    await expect(player.cta).toHaveAccessibleName(/^Resume the briefing, \d+ min left$/);
    await player.finger.press(player.cta);
    await expect(player.root).toHaveAttribute("data-player-state", "playing");
    // It plays on from the kept place, not from the top.
    expect(await time(page)).toBeGreaterThan(saved - 1);
  });

  test("remembers a pause the system caused and offers resume instead of playing again", async ({
    player,
    audio,
    page,
  }) => {
    await player.open();
    await player.play();
    // A call or an alarm pauses the element without anyone pressing pause.
    await page.evaluate(() => window.__audios[0]?.pause());
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(page.locator(".dock-caption")).toHaveText("Paused by another app");
    expect((await audio.read())?.paused).toBe(true);
    await player.openPlayer();
    const notice = page.getByRole("status").filter({ hasText: "Paused by another app" });
    await expect(notice).toBeVisible();
    await player.finger.press(player.dialog.getByRole("button", { name: "Resume" }));
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(notice).toHaveCount(0);
  });
});
