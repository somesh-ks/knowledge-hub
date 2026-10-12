import { expect, test } from "./lab";

test.describe("when playback does not go to plan", () => {
  test("shows buffering only after 300 ms, then plays when the data arrives", async ({
    lab,
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The first byte of the narration is held back, as on a slow connection.
    await page.route("**/lab-narration.mp3*", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/dev/player-lab", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("astro-island[ssr]") === null);
    await lab.cta.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "loading");
    // Inside the first 300 ms the chip already reads as playing and shows no spinner.
    await expect(lab.cta).toHaveAttribute("data-state", "current");
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText(/min left$/);
    await expect(lab.cta).toHaveAccessibleName(/^Pause the briefing, \d+ min left$/);
    await expect(lab.cta).toHaveAttribute("data-state", "preparing", { timeout: 3_000 });
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText("Loading");
    await expect(lab.cta).toHaveAccessibleName("Pause the briefing, loading");
    await expect(page.locator(".dock-btn[data-primary] .spinner")).toBeVisible();
    release();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 10_000,
    });
    await expect(lab.cta).toHaveAttribute("data-state", "current");
    await expect(lab.cta).toHaveAccessibleName(/^Pause the briefing, \d+ min left$/);
  });

  test("remembers a pause the system caused and offers resume instead of playing again", async ({
    lab,
    audio,
    page,
  }) => {
    await lab.open();
    await lab.play();
    // A call or an alarm pauses the element without anyone pressing pause.
    await page.waitForTimeout(1_200);
    await page.evaluate(() => window.__audios[0]?.pause());
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(page.locator(".dock-caption")).toHaveText("Paused by another app");
    await page.waitForTimeout(800);
    expect((await audio.read())?.paused).toBe(true);
    await lab.openPlayer();
    await expect(
      page.getByRole("status").filter({ hasText: "Paused by another app" }),
    ).toBeVisible();
    await lab.dialog.getByRole("button", { name: "Resume" }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(page.getByRole("status").filter({ hasText: "Paused by another app" })).toHaveCount(
      0,
    );
  });

  test("explains a missing audio file in plain language and retries from the same place", async ({
    lab,
    page,
  }) => {
    await page.route("**/lab-narration.mp3*", (route) => route.fulfill({ status: 404, body: "" }));
    await lab.open();
    await lab.cta.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "error");
    // The chip draws the refresh mark like the disc, not a play triangle.
    await expect(lab.cta).toHaveAttribute("data-state", "error");
    await expect(lab.cta.locator(".chip-refresh")).toBeVisible();
    await expect(lab.cta.locator(".chip-glyph > .swap")).toBeHidden();
    await expect(lab.cta.locator("[data-chip-label]")).toHaveText("Try again");
    await expect(page.locator(".dock-caption")).toHaveText("Audio is not available");
    // Nothing is being read, so the bar names the recording and not its first story.
    await expect(page.locator(".dock-title")).toHaveText(lab.facts.title);
    await lab.openPlayer();
    const notice = page.getByRole("alert").filter({ hasText: "not available" });
    await expect(notice).toHaveText("Audio is not available for this briefing.");
    // Trying again cannot bring back a missing file, so the notice offers no button of its own;
    // the Play disc is named Try again and draws a clockwise arrow, not a play triangle. The story
    // line and its source are gone: nothing is being read.
    await expect(notice.getByRole("button")).toHaveCount(0);
    const disc = lab.dialog.getByRole("button", { name: "Try again" });
    await expect(disc).toHaveCount(1);
    // One glyph, the arrow, where play and pause would otherwise swap.
    await expect(disc.locator(".glyph-paused, .glyph-playing")).toHaveCount(0);
    await expect(disc.locator(".ui-icon")).toHaveCount(1);
    await expect(lab.dialog.locator(".player-story, .player-source-link")).toHaveCount(0);
    // The file comes back; the disc tries again.
    await page.unroute("**/lab-narration.mp3*");
    await disc.tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 10_000,
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
