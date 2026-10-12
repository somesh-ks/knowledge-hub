import type { Page } from "@playwright/test";
import { expect, type Finger, fulfillNarration, type PlayerPage, test } from "./helpers";

const EPISODE = "/e/ep-20261007-1930";

/**
 * Stands in the narration of the open episode page, each turn a short recording that carries its
 * story, so the episode is laid out as stories behind an opening rundown (whose turn has none).
 */
async function mockNarration(page: Page): Promise<void> {
  const turns = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.turns as { key: string; item_id?: string | null }[]).map((turn) => ({
      key: turn.key,
      item_id: turn.item_id ?? null,
    }));
  });
  expect(turns[0]?.item_id).toBeNull();
  const segment = (key: string, confirmed: boolean) => ({
    key,
    item_id: turns.find((turn) => turn.key === key)?.item_id ?? null,
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
        segments: turns.map((turn) => segment(turn.key, false)),
      },
    }),
  );
  await page.route("**/narrated/*.mp3", (route) => fulfillNarration(route));
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    return route.fulfill({ json: { status: 200, segment: segment(key, true) } });
  });
}

async function startEpisode(player: PlayerPage, finger: Finger, page: Page): Promise<void> {
  await player.open(EPISODE);
  await mockNarration(page);
  await finger.press(player.cta);
  await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
    timeout: 8_000,
  });
  await player.openPlayer();
}

test.describe("an episode's rundown and the controls under the transcript", () => {
  test("the rundown before story 1 is no story: Next goes to story 1 and Previous to 0:00 @smoke", async ({
    player,
    finger,
    page,
  }) => {
    await startEpisode(player, finger, page);
    const caption = page.locator("[data-player-dock] .dock-caption");
    // While the rundown plays the bar says what the recording is, and no story is current.
    await expect(caption).not.toContainText("Story");
    await expect(caption).toContainText("Discussion");
    await expect(player.dialog.locator('.story-row[aria-current="true"]')).toHaveCount(0);
    // The open page says the same on the line kept for the story, not blank room.
    await expect(page.locator(".player-meta .player-story")).toContainText("Discussion");
    // With a mouse on a wide screen the story steps are the bar's; elsewhere the page's.
    const shown = (name: string) =>
      page
        .locator("[data-player-surface]")
        .getByRole("button", { name, exact: true })
        .filter({ visible: true })
        .first();
    await shown("Pause").click();
    const next = shown("Next story");
    const previous = shown("Previous story");
    await finger.press(next);
    await expect(player.scrubber).toHaveAttribute("aria-valuetext", /^0:18 of .*story 1 of /);
    await expect(caption).toContainText("Story 1 of");
    // Previous from the first seconds of story 1 goes back to the start, never forward.
    await finger.press(previous);
    await expect(player.scrubber).toHaveAttribute("aria-valuetext", /^0:00 of [0-9:]+$/);
    await expect(caption).not.toContainText("Story");
    await expect(previous).toHaveAttribute("aria-disabled", "true");
  });

  test("on one column, Next story twice keeps the controls in place and goes forward", async ({
    player,
    finger,
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 1024,
      "the transcript scrolls in its own column",
    );
    await startEpisode(player, finger, page);
    await expect(player.dialog.getByRole("region", { name: "Transcript" })).toBeVisible();
    const next = player.dialog.getByRole("button", { name: "Next story" });
    const before = await player.boxOf(next);
    await finger.press(next);
    await expect(player.scrubber).toHaveAttribute("aria-valuetext", /story 1 of /);
    // Long enough for a smooth scroll to have moved the page.
    await page.waitForTimeout(800);
    expect((await player.boxOf(next)).y).toBeCloseTo(before.y, 0);
    expect(await player.sheet.evaluate((element) => element.scrollTop)).toBe(0);
    await finger.press(next);
    await expect(player.scrubber).toHaveAttribute("aria-valuetext", /story 2 of /);
    await page.waitForTimeout(800);
    expect((await player.boxOf(next)).y).toBeCloseTo(before.y, 0);
  });

  test("on a wide screen with a mouse the cover and the controls hold still from the rundown to a failure @wide", async ({
    player,
    finger,
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "needs the two-column page");
    await startEpisode(player, finger, page);
    const cover = page.locator("[data-player-surface] [data-player-cover]");
    const play = () =>
      page
        .locator("[data-player-surface]")
        .getByRole("button", { name: /^(Pause|Play|Try again)$/ })
        .filter({ visible: true })
        .first();
    const place = async () => [(await player.boxOf(cover)).y, (await player.boxOf(play())).y];
    const rundown = await place();
    const next = page
      .locator("[data-player-surface]")
      .getByRole("button", { name: "Next story", exact: true })
      .filter({ visible: true })
      .first();
    await finger.press(next);
    await expect(player.scrubber).toHaveAttribute("aria-valuetext", /story 1 of /);
    await expect(player.dialog.locator(".player-source-link")).toBeVisible();
    expect(await place()).toEqual(rundown);
    // A failure shows no story and no source, and nothing moves.
    await page.route("**/narrated/*.mp3", (route) => route.fulfill({ status: 404, body: "" }));
    await finger.press(next);
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    expect(await place()).toEqual(rundown);
  });

  test("the open page and the bar under it show one play control @desktop", async ({
    player,
    finger,
    page,
  }) => {
    await startEpisode(player, finger, page);
    const pauses = page
      .locator("[data-player-surface]")
      .getByRole("button", { name: "Pause", exact: true })
      .filter({ visible: true });
    await expect(pauses).toHaveCount(1);
    if (finger.touch) {
      // A wide touch screen: the bar under the open page does not repeat its transport either.
      await page.setViewportSize({ width: 1180, height: 820 });
      await expect(pauses).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Next story" }).filter({ visible: true }),
      ).toHaveCount(1);
    } else {
      // Between 40 and 64rem the bar stays under the page too, with a mouse as with a finger.
      await page.setViewportSize({ width: 820, height: 1000 });
      await expect(pauses).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Next story" }).filter({ visible: true }),
      ).toHaveCount(1);
    }
  });
});
