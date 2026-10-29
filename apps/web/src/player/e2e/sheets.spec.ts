import type { Route } from "@playwright/test";
import { expect, SITE, test } from "./helpers";

function reply(route: Route, status: number, body: Record<string, unknown>) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

// The Regenerate sheet used to carry a stepper of its own; the run now rides in the indicator above
// the navigation, where the player's bar is also standing (2026-10-27). Its journeys (the request,
// the stages, the new briefing) are in e2e/briefingRun.spec.ts; what only the player can break is
// that the indicator and the bar do not sit on each other.
test("Regenerate while a podcast plays: the run line stands clear above the bar and opens the new podcast", async ({
  player,
  page,
}) => {
  let sent: unknown = null;
  await page.route("**/api/generate", (route) => {
    sent = route.request().postDataJSON();
    return reply(route, 202, { run_id: 77, started_at: "2026-10-07T07:13:00Z" });
  });
  const bodies = [
    { run_id: 77, state: "running", step: "reading", stage: 1, stages: 7, label: "Gathering" },
    { run_id: 77, state: "running", step: "writing", stage: 3, stages: 7, label: "Writing" },
    {
      run_id: 77,
      state: "completed",
      step: "publishing",
      outcome: "published",
      digest_id: SITE.earlier,
    },
  ];
  let calls = 0;
  await page.route("**/api/status**", (route) => {
    const body = bodies[Math.min(calls, bodies.length - 1)] ?? {};
    calls += 1;
    return reply(route, 200, body);
  });
  await player.open();
  await player.play();
  // The indicator polls on the page clock, so the run's minutes pass in a moment.
  await page.clock.install();
  const dialog = await player.openGenerate();
  await player.finger.press(dialog.getByRole("button", { name: "Regenerate" }));
  await expect(dialog).toBeHidden();
  // Regenerate replaces the briefing on the page over its own window (D104).
  expect(sent).toEqual({ replace: SITE.path.replace("/d/", "") });
  const card = page.locator("[data-run-card]");
  await expect(card).toBeVisible();
  const bar = await player.dockSettled();
  const strip = await player.boxOf(card);
  expect(strip.y + strip.height).toBeLessThanOrEqual(bar.y + 1);
  await page.clock.runFor(4_100);
  await page.clock.runFor(4_100);
  const open = page.locator("[data-run-library]");
  await expect(open).toBeVisible();
  await player.finger.press(open);
  await expect(page).toHaveURL(new RegExp(`/d/${SITE.earlier}$`));
});
