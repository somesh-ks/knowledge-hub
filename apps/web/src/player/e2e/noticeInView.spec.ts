import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./lab";

const NARRATION_FILE = fileURLToPath(new URL("../dev/lab-narration.mp3", import.meta.url));

/** A briefing narrated on Play: the intro's file is made, every story after it is refused (daily cap). */
async function serveRefusal(page: Page): Promise<void> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  });
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
        segments: ["intro", ...ids].map((key) => segment(key, false)),
      },
    }),
  );
  await page.route("**/narrated/*.mp3", (route) =>
    route.request().url().endsWith("/intro.mp3")
      ? route.fulfill({ path: NARRATION_FILE })
      : route.fulfill({ status: 404, body: "" }),
  );
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    return key === "intro"
      ? route.fulfill({ json: { status: 200, segment: segment(key, true) } })
      : route.fulfill({ status: 429, json: { error: "daily_cap" } });
  });
}

/** Where an element's top is, measured from the top of the open page's view. */
function topInView(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const view = node.closest("[data-player-page]")?.getBoundingClientRect().top ?? 0;
    return node.getBoundingClientRect().top - view;
  });
}

test.describe("the notice answers a press @surface", () => {
  test.skip(({ lab }) => lab.target === "lab", "needs a built page");
  test.skip(({ isMobile }) => !isMobile, "the page scrolls under its title on one column");

  test("scrolled down to the transport, a failure scrolls nothing, and a press on Play brings its reason into view", async ({
    lab,
    page,
  }) => {
    await lab.open("/d/2026-10-05");
    await serveRefusal(page);
    await lab.play();
    await expect(lab.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await lab.openPlayer();
    const scroller = lab.dialog;
    const disc = lab.dialog.locator(".transport [data-primary]");
    // The listener reads on: the transport is near the top of the view, the title above it.
    await disc.evaluate((node) => {
      const view = node.closest("[data-player-page]");
      if (view) view.scrollTop += node.getBoundingClientRect().top - 80;
    });
    const scrolled = await scroller.evaluate((node) => node.scrollTop);
    expect(scrolled).toBeGreaterThan(0);

    await lab.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(lab.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const notice = lab.dialog.getByRole("alert");
    await expect(notice).toContainText("Daily narration limit reached");
    // Nothing asked for it: the page stays where the listener left it, and the reason is out of view.
    expect(await scroller.evaluate((node) => node.scrollTop)).toBe(scrolled);
    expect(await topInView(notice)).toBeLessThan(0);

    await disc.click();
    await expect(notice).toContainText("Daily narration limit reached");
    await expect.poll(() => topInView(notice)).toBeGreaterThanOrEqual(0);
    // Only as far as the reason: the disc that was pressed is still in view.
    const discTop = await topInView(disc);
    const height = await scroller.evaluate((node) => node.clientHeight);
    expect(discTop).toBeLessThan(height);

    // With the reason in view a press moves nothing.
    const settled = await scroller.evaluate((node) => node.scrollTop);
    await disc.click();
    await expect(notice).toContainText("Daily narration limit reached");
    expect(await scroller.evaluate((node) => node.scrollTop)).toBe(settled);
  });
});
