import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

const NARRATION_FILE = fileURLToPath(new URL("../dev/lab-narration.mp3", import.meta.url));
const EPISODE = "/e/ep-20261007-1930";
const READOUT = "/e/ep-20261006-0900";

/** Stands in the narration of the open episode page: every turn of its script, a short recording. */
async function mockNarration(page: Page): Promise<string[]> {
  const keys = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.turns as { key: string }[]).map((turn) => turn.key);
  });
  expect(keys.length).toBeGreaterThan(0);
  const segment = (key: string, confirmed: boolean) => ({
    key,
    item_id: null,
    characters: 300,
    audio: { url: `/narrated/${key}.mp3`, duration_ms: 18_600, confirmed },
  });
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: keys.map((key) => segment(key, false)),
      },
    }),
  );
  await page.route("**/narrated/*.mp3", (route) => route.fulfill({ path: NARRATION_FILE }));
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    return route.fulfill({ json: { status: 200, segment: segment(key, true) } });
  });
  return keys;
}

test.describe("an episode's script in the open player", () => {
  test.skip(({ lab }) => lab.target === "lab", "needs a built episode page");

  test("a readout names nobody: the transcript is its text alone @surface", async ({
    lab,
    finger,
    page,
  }) => {
    await lab.open(READOUT);
    await mockNarration(page);
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    const script = lab.dialog.getByRole("region", { name: "Transcript" });
    await expect(script).toBeVisible();
    await expect(script.locator(".script-turn").first()).toBeVisible();
    await expect(script.locator(".script-speaker")).toHaveCount(0);
  });

  test("names each host after their voice, marks the turn being spoken and seeks on a tap @surface", async ({
    lab,
    finger,
    page,
  }) => {
    await lab.open(EPISODE);
    expect((await mockNarration(page)).length).toBeGreaterThan(2);
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    const script = lab.dialog.getByRole("region", { name: "Transcript" });
    await expect(script).toBeVisible();
    // Opening shows the top of the page (the cover and the controls); the script does not scroll
    // the first turn into the middle. Smooth scrolling takes a moment, so wait it out.
    await page.waitForTimeout(1_500);
    expect(await lab.sheet.evaluate((element) => element.scrollTop)).toBe(0);
    // A turn is its text, with the speaker's name over it where the speaker changes: the names the
    // episode stored, the lead first.
    await expect(script.locator(".script-speaker").nth(0)).toHaveText("Maya");
    await expect(script.locator(".script-speaker").nth(1)).toHaveText("Theo");
    // Exactly one turn is the current one, and it is the first.
    await expect(script.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(script.locator('[data-turn="0"]')).toHaveAttribute("aria-current", "true");
    // The word being said is lit, one at a time.
    await expect(script.locator("[data-spoken]")).toHaveCount(1);
    // The speed sits between the skips and opens a slider; an arrow moves it one step.
    await lab.dialog.getByRole("button", { name: "Playback speed 1x" }).click();
    const slider = page.getByRole("slider", { name: "Playback speed" });
    await expect(slider).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(lab.dialog.getByRole("button", { name: "Playback speed 1.05x" })).toBeVisible();
    await expect(lab.root).toHaveAttribute("data-player", "open");
    // A tap on a later turn plays from there.
    await finger.press(script.locator('[data-turn="2"]'));
    await expect(script.locator('[data-turn="2"]')).toHaveAttribute("aria-current", "true", {
      timeout: 8_000,
    });
  });

  test("on one column the open page holds still at every turn change until the listener scrolls @surface", async ({
    lab,
    finger,
    page,
  }) => {
    test.skip(
      await page.evaluate(() => window.matchMedia("(min-width: 64rem)").matches),
      "from 64rem the script follows in its own column",
    );
    await lab.open(EPISODE);
    await mockNarration(page);
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    const script = lab.dialog.getByRole("region", { name: "Transcript" });
    await expect(script).toBeVisible();
    // Nothing scrolled: the voice moves through turns (a click that does not scroll stands in for
    // the clock) and the page never moves.
    for (const turn of [1, 2]) {
      await script.locator(`[data-turn="${turn}"]`).dispatchEvent("click");
      await expect(script.locator(`[data-turn="${turn}"]`)).toHaveAttribute(
        "aria-current",
        "true",
        {
          timeout: 8_000,
        },
      );
      await page.waitForTimeout(1_200);
      expect(await lab.sheet.evaluate((element) => element.scrollTop)).toBe(0);
    }
  });

  test("Back to now shows only while the turn being spoken is out of view @surface", async ({
    lab,
    finger,
    page,
  }) => {
    test.skip(
      await page.evaluate(() => window.matchMedia("(min-width: 64rem)").matches),
      "from 64rem the script follows in its own column",
    );
    await lab.open(EPISODE);
    await mockNarration(page);
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    const script = lab.dialog.getByRole("region", { name: "Transcript" });
    await script.scrollIntoViewIfNeeded();
    await lab.sheet.evaluate((sheet) => {
      const top = sheet.querySelector(".player-script")?.getBoundingClientRect().top ?? 0;
      sheet.scrollTop += top - 120;
    });
    // The listener is in charge (a wheel holds following) in the same moment the voice moves on.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-player-surface] [data-turn="2"]')?.click();
      document.querySelector("[data-player-page]")?.dispatchEvent(new Event("wheel"));
    });
    const now = script.locator('.script-turn[aria-current="true"]');
    await expect(script.locator('[data-turn="2"]')).toHaveAttribute("aria-current", "true", {
      timeout: 8_000,
    });
    await expect(now).toBeInViewport();
    await page.waitForTimeout(600);
    await expect(page.getByRole("button", { name: "Back to now" })).toHaveCount(0);
  });

  test("on two columns following scrolls the list and never the page @surface", async ({
    lab,
    finger,
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await lab.open(EPISODE);
    await mockNarration(page);
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    const script = lab.dialog.getByRole("region", { name: "Transcript" });
    const turns = await script.locator("[data-turn]").count();
    await script.locator(`[data-turn="${turns - 1}"]`).dispatchEvent("click");
    await expect(script.locator(`[data-turn="${turns - 1}"]`)).toHaveAttribute(
      "aria-current",
      "true",
      { timeout: 8_000 },
    );
    await page.waitForTimeout(1_200);
    expect(await lab.sheet.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0);
  });

  test("the transcript is one Tab stop that the arrow keys move through, and Tab follows the transport's order @surface", async ({
    lab,
    finger,
    page,
  }) => {
    await lab.open(EPISODE);
    const keys = await mockNarration(page);
    expect(keys.length).toBeGreaterThan(2);
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    await lab.dialog.getByRole("button", { name: "Pause" }).click();
    const script = lab.dialog.getByRole("region", { name: "Transcript" });
    const turns = script.locator(".script-turn");
    await expect(turns.first()).toBeVisible();
    // One stop for the whole list: the turn being spoken.
    await expect(script.locator('.script-turn[tabindex="0"]')).toHaveCount(1);
    await expect(script.locator('[data-turn="0"]')).toHaveAttribute("tabindex", "0");
    await expect(turns.nth(1)).toHaveAttribute("tabindex", "-1");
    // Tab from Play reaches what the eye sees next: Forward ten, then (where shown) Next, then the
    // speed, which is last in the transport whatever its place in the grid.
    const play = lab.dialog.getByRole("button", { name: "Play", exact: true });
    await play.focus();
    const order: string[] = [];
    for (let press = 0; press < 3; press += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""),
      );
    }
    expect(order[0]).toBe("Forward 10 seconds");
    expect(order.indexOf("Playback speed 1x")).toBeGreaterThan(0);
    // The arrows, Home and End move inside the list; Tab leaves it in one press.
    await script.locator('[data-turn="0"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(script.locator('[data-turn="1"]')).toBeFocused();
    await expect(script.locator('[data-turn="1"]')).toHaveAttribute("tabindex", "0");
    await expect(script.locator('[data-turn="0"]')).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("End");
    await expect(script.locator(`[data-turn="${keys.length - 1}"]`)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(script.locator('[data-turn="0"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    // Enter plays the focused turn.
    await page.keyboard.press("Enter");
    await expect(script.locator('[data-turn="2"]')).toHaveAttribute("aria-current", "true", {
      timeout: 8_000,
    });
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".script-turns"))).toBeNull();
  });
});
