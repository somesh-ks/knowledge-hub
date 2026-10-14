import type { Route } from "@playwright/test";
import { expect, SITE, test } from "./helpers";
import { enterPassphrase, PASSPHRASE_REQUIRED } from "./passphrase";

function reply(route: Route, status: number, body: Record<string, unknown>) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("Regenerate: the run request, the six steps while it goes, then the new briefing", async ({
  player,
  page,
}) => {
  let sent: unknown = null;
  await page.route("**/api/generate", (route) => {
    sent = route.request().postDataJSON();
    return reply(route, 202, { run_id: 77, started_at: "2026-10-07T07:13:00Z" });
  });
  const bodies = [
    { run_id: 77, state: "queued", step: null },
    { run_id: 77, state: "running", step: "reading" },
    { run_id: 77, state: "running", step: "writing" },
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
  // The sheet polls on the page clock, so the run's minutes pass in a moment.
  await page.clock.install();
  const dialog = await player.openGenerate();
  if (!PASSPHRASE_REQUIRED) {
    // With the passphrase step off (D41) the sheet asks for nothing.
    await expect(dialog.getByLabel("Passphrase")).toHaveCount(0);
  }
  await enterPassphrase(dialog);
  await player.finger.press(dialog.getByRole("button", { name: "Regenerate" }));
  const steps = dialog.getByRole("list", { name: "Progress" }).getByRole("listitem");
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(0)).toContainText("In progress");
  await expect(dialog.getByRole("button", { name: "Generating" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // Regenerate replaces the briefing on the page over its own window (D104).
  expect(sent).toEqual({
    passphrase: PASSPHRASE_REQUIRED ? "secret" : "open",
    replace: SITE.path.replace("/d/", ""),
  });
  await page.clock.runFor(3_100);
  await expect(steps.nth(1)).toContainText("In progress");
  await expect(steps.nth(0)).toContainText("Done");
  await page.clock.runFor(3_100);
  await expect(steps.nth(3)).toContainText("In progress");
  await page.clock.runFor(3_100);
  await expect(dialog.getByText("Briefing ready")).toBeVisible();
  for (let index = 0; index < 6; index += 1) await expect(steps.nth(index)).toContainText("Done");
  await player.finger.press(dialog.getByRole("button", { name: "Open the new briefing" }));
  await expect(page).toHaveURL(new RegExp(`/d/${SITE.earlier}$`));
});
