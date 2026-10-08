import { fileURLToPath } from "node:url";
import { expect, test } from "./lab";

const NARRATION_FILE = fileURLToPath(new URL("../dev/lab-narration.mp3", import.meta.url));
const EPISODE = "/e/ep-20261007-1930";

test.describe("an episode's script in the open player", () => {
  test.skip(({ lab }) => lab.target === "lab", "needs a built episode page");

  test("shows Ada and Leo, marks the turn being spoken and seeks on a tap @surface", async ({
    lab,
    finger,
    page,
  }) => {
    await lab.open(EPISODE);
    const keys = await page.evaluate(() => {
      const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
      return (data.turns as { key: string }[]).map((turn) => turn.key);
    });
    expect(keys.length).toBeGreaterThan(2);
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
    await finger.press(lab.cta);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 8_000,
    });
    await lab.openPlayer();
    const script = lab.dialog.getByRole("region", { name: "Script" });
    await expect(script).toBeVisible();
    await expect(script.locator('[data-tone="lead"] .script-name').first()).toHaveText("Ada");
    await expect(script.locator('[data-tone="guest"] .script-name').first()).toHaveText("Leo");
    // Exactly one turn is the current one, and it is the first.
    await expect(script.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(script.locator('[data-turn="0"]')).toHaveAttribute("aria-current", "true");
    // A tap on a later turn plays from there.
    await finger.press(script.locator('[data-turn="2"]'));
    await expect(script.locator('[data-turn="2"]')).toHaveAttribute("aria-current", "true", {
      timeout: 8_000,
    });
  });
});
