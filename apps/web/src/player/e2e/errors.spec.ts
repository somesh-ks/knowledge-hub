import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

const NARRATION_FILE = fileURLToPath(new URL("../dev/lab-narration.mp3", import.meta.url));

type Answer = { file: boolean } | { refusal: string };

/**
 * A briefing whose segments are listed with no files. `answer` says how each segment is met: a made
 * file (which may itself be missing) or a refusal from the server.
 */
async function serve(page: Page, answer: (key: string) => Answer): Promise<void> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  });
  const keys = ["intro", ...ids];
  const segment = (key: string, confirmed: boolean) => ({
    key,
    item_id: key === "intro" ? null : key,
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
  await page.route("**/narrated/*.mp3", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").pop()?.replace(".mp3", "") ?? "";
    const met = answer(key);
    return "file" in met && met.file
      ? route.fulfill({ path: NARRATION_FILE })
      : route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    const met = answer(key);
    if ("refusal" in met) return route.fulfill({ status: 429, json: { error: met.refusal } });
    return route.fulfill({ json: { status: 200, segment: segment(key, true) } });
  });
}

test.describe("a recording that fails @surface", () => {
  test.skip(({ lab }) => lab.target === "lab", "needs a built page");

  test("a missing audio file never shows the browser's debug text", async ({
    lab,
    page,
    finger,
  }) => {
    await lab.open("/d/2026-10-05");
    await serve(page, () => ({ file: false }));
    await finger.press(lab.cta);
    await expect(lab.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    await lab.openPlayer();
    await expect(lab.dialog.getByRole("alert")).toContainText("Audio is not available");
    await expect(page.locator("body")).not.toContainText("MEDIA_ELEMENT_ERROR");
    const live = await page.locator("[aria-live]").allTextContents();
    expect(live.join(" ")).not.toContain("MEDIA_ELEMENT_ERROR");
  });

  test("a refusal that stands offers no Try again, in the notice or on the disc", async ({
    lab,
    page,
  }) => {
    await lab.open("/d/2026-10-05");
    await serve(page, (key) => (key === "intro" ? { file: true } : { refusal: "daily_cap" }));
    await lab.play();
    await expect(lab.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await lab.openPlayer();
    await lab.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(lab.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const notice = lab.dialog.getByRole("alert");
    await expect(notice).toContainText("Daily narration limit reached");
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(lab.dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.locator(".dock-caption")).toHaveText("Daily limit reached");
  });
});
