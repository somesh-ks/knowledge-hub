import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

const NARRATION_FILE = fileURLToPath(new URL("../dev/lab-narration.mp3", import.meta.url));

/**
 * A briefing with no audio yet: the server lists its segments with no files, and makes each one
 * when asked, after `delayMs`. Returns the keys that were asked for, in order.
 */
async function serveNarration(page: Page, delayMs: number): Promise<string[]> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  });
  const keys = ["intro", ...ids];
  const made: string[] = [];
  const finished = new Set<string>();
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: keys.map((key) => ({
          key,
          item_id: key === "intro" ? null : key,
          characters: 300,
          // The address the file will have once made, as the real server answers: a guess.
          audio: { url: `/narrated/${key}.mp3`, duration_ms: 18_600, confirmed: false },
        })),
      },
    }),
  );
  // The file is not there until it has been made, as on the blob store.
  await page.route("**/narrated/*.mp3", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").pop()?.replace(".mp3", "") ?? "";
    return made.includes(key) && finished.has(key)
      ? route.fulfill({ path: NARRATION_FILE })
      : route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/narrate", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment } = route.request().postDataJSON() as { segment: string };
    made.push(segment);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    finished.add(segment);
    return route.fulfill({
      json: {
        status: 200,
        segment: {
          key: segment,
          item_id: segment === "intro" ? null : segment,
          characters: 300,
          audio: { url: `/narrated/${segment}.mp3`, duration_ms: 17_000, confirmed: true },
        },
      },
    });
  });
  return made;
}

test.describe("the first press of Play on a page with no audio yet", () => {
  test("plays by itself once the first file is made, with no second press @surface", async ({
    lab,
    audio,
    finger,
    page,
  }) => {
    await lab.open(lab.target === "lab" ? "/dev/player-lab-preparing" : "/d/2026-10-05");
    await serveNarration(page, 1_500);
    await finger.press(lab.cta);
    await expect(lab.cta).toHaveAttribute("data-state", "preparing");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await expect.poll(async () => (await audio.read())?.paused, { timeout: 4_000 }).toBe(false);
    await expect
      .poll(async () => (await audio.read())?.currentTime ?? 0, { timeout: 6_000 })
      .toBeGreaterThan(0.5);
    await expect(page.locator(".dock-btn[data-primary]")).toHaveAttribute("data-loading", "false");
  });
});
