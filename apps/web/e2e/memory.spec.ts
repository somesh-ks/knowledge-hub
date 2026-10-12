import type { Page } from "@playwright/test";
import { expect, hydrated, SILENT_DIGEST, test } from "./fixtures";

/**
 * What the device remembers of a recording reads the same everywhere: the stories heard, the
 * briefing chip and the floating Play, the Library's card and the Earlier shelf (resume.ts,
 * readerSync.ts, cardProgress.ts).
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Narration on Play for the briefing without audio, every file already made. */
async function narrateSilent(page: Page): Promise<void> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  });
  const segment = (key: string, confirmed: boolean) => ({
    key,
    item_id: key === "intro" ? null : key,
    characters: 300,
    audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed },
  });
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: ["intro", ...ids].map((key) => segment(key, false)),
      },
    }),
  );
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    return route.fulfill({ json: { status: 200, segment: segment(key, true) } });
  });
}

const story = (page: Page, index: number) => page.locator("[data-item-id]").nth(index);

async function expectHeard(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await expect(story(page, index)).toHaveAttribute("data-state", "played");
  }
}

test("the stories heard keep their Played marks after another recording and a reload", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/d/2026-10-07");
  await hydrated(page);
  const chip = page.locator(".hero [data-play-digest]");
  await chip.click();
  // 3 s a story: playing goes on out of the first four into the fifth.
  await expect(story(page, 4)).toHaveAttribute("data-state", "current", { timeout: 20_000 });
  await chip.click();
  await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
  await expectHeard(page, 4);

  // Another recording: the briefing without audio, narrated on Play.
  await page.goto(SILENT_DIGEST);
  await hydrated(page);
  await narrateSilent(page);
  await page.locator(".hero [data-play-digest]").click();
  await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");

  await page.goto("/d/2026-10-07");
  await hydrated(page);
  await expectHeard(page, 4);
  await expect(chip).toHaveAccessibleName(/^Resume the briefing, \d+ min left$/);

  await page.reload();
  await hydrated(page);
  await expectHeard(page, 4);
  await expect(story(page, 4)).not.toHaveAttribute("data-state", "played");
  await expect(chip).toHaveAccessibleName(/^Resume the briefing, \d+ min left$/);
});

test("a briefing without audio says where it was left, as its cards do", async ({ page }) => {
  await page.goto("/library");
  await page.evaluate(() => localStorage.setItem("dispatch:resume:2026-10-05", "60"));

  await page.goto(SILENT_DIGEST);
  await hydrated(page);
  const chip = page.locator(".hero [data-play-digest]");
  await expect(chip.locator("[data-chip-label]")).toHaveText("2 min left");
  await expect(chip).toHaveAccessibleName("Resume the briefing, 2 min left");
  await expect(page.locator(".play-fab")).toHaveAttribute(
    "aria-label",
    "Resume the briefing, 2 min left",
  );
  await expect(page.locator(".play-fab [data-chip-label]")).toHaveText("Resume · 2 min left");

  await page.goto("/library");
  await hydrated(page);
  const card = page.locator('[data-card][data-id="2026-10-05"]');
  await expect(card.locator("[data-cover-progress]")).toBeVisible();
  await expect(card.locator("[data-cover-progress]")).toHaveAttribute("style", /--progress: 33%/);

  await page.goto("/");
  await hydrated(page);
  const shelf = page.locator('.earlier [data-card][data-id="2026-10-05"]');
  await expect(shelf.locator("[data-cover-progress]")).toBeVisible();
});

test("a briefing without audio heard to the end says Played everywhere", async ({ page }) => {
  await page.goto("/library");
  await page.evaluate(() => localStorage.setItem("dispatch:played:2026-10-05", "1"));

  await page.goto(SILENT_DIGEST);
  await hydrated(page);
  const chip = page.locator(".hero [data-play-digest]");
  await expect(chip.locator("[data-chip-label]")).toHaveText("Played");
  await expect(chip).toHaveAttribute("data-state", "played");
  await expect(page.locator(".play-fab [data-chip-label]")).toHaveText("Played");
  await expect(page.locator(".play-fab")).toHaveAttribute(
    "aria-label",
    "Play the briefing again, played",
  );

  await page.goto("/library");
  await hydrated(page);
  await expect(page.locator('[data-card][data-id="2026-10-05"] [data-card-length]')).toHaveText(
    "Played",
  );

  await page.goto("/");
  await hydrated(page);
  await expect(
    page.locator('.earlier [data-card][data-id="2026-10-05"] [data-card-length]'),
  ).toHaveText("Played");
});

test("the floating Play on Today follows the chip", async ({ page }) => {
  await page.goto("/library");
  await page.evaluate(() => localStorage.setItem("dispatch:resume:2026-10-07", "20"));
  await page.goto("/");
  await hydrated(page);
  await page.mouse.wheel(0, 1200);
  const chip = page.locator(".hero [data-play-digest]");
  const fab = page.locator(".play-fab");
  await expect(chip.locator("[data-chip-label]")).toHaveText("1 min left");
  await expect(fab.locator("[data-chip-label]")).toHaveText("Resume · 1 min left");
  await expect(fab).toHaveAttribute("aria-label", "Resume the briefing, 1 min left");
});
