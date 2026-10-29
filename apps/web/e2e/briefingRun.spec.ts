import type { Page } from "@playwright/test";
import { expect, hydrated, queueDock, queueStatus, test, toastOpen, toastText } from "./fixtures";

const ID = "2026-10-07";
const text = queueStatus;
const dialog = (page: Page) => page.getByRole("dialog", { name: "Regenerate" });

async function openRegenerate(page: Page): Promise<void> {
  await page.goto(`/d/${ID}`);
  await hydrated(page);
  await expect(async () => {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Regenerate" }).click({ timeout: 2000 });
    await expect(dialog(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** The routes a Regenerate talks to: POST /api/generate (its bodies kept) and the status answers in order. */
async function mock(page: Page, states: unknown[]): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/generate", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ run_id: 90 + bodies.length, started_at: "2026-10-07T07:13:00Z" }),
    });
  });
  let asked = 0;
  await page.route("**/api/status?**", async (route) => {
    const next = states[Math.min(asked, states.length - 1)];
    asked += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(next),
    });
  });
  return bodies;
}

// The 2026-10-27 owner ask: a Regenerate is followed in the same queue a Catch up has, above
// the navigation, not in a sheet that has to stay open. The sheet is the form and nothing else.
test.describe("a Regenerate, followed in the podcast queue", () => {
  test("the sheet closes at once, the line names each stage and the new podcast is offered", async ({
    page,
  }) => {
    const bodies = await mock(page, [
      {
        run_id: 91,
        state: "running",
        step: "reading",
        stage: 1,
        stages: 7,
        label: "Gathering stories from your sources",
      },
      {
        run_id: 91,
        state: "running",
        step: "writing",
        stage: 3,
        stages: 7,
        label: "Writing the podcast",
      },
      { run_id: 91, state: "completed", step: null, outcome: "published", digest_id: ID },
    ]);
    await openRegenerate(page);
    await dialog(page).getByRole("textbox").fill("  More on design systems  ");
    await dialog(page).getByRole("button", { name: "Regenerate" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ feedback: "More on design systems", replace: ID });
    await expect(dialog(page)).toBeHidden();
    await expect(queueDock(page)).toBeVisible();
    await expect(text(page)).toHaveText(/Waiting to start|Gathering stories/);
    await expect(text(page)).toHaveText("Writing the podcast", { timeout: 15_000 });
    // Finished, it leaves the queue. The page on screen is the old briefing: the toast offers the new one.
    await expect(toastText(page)).toHaveText("Podcast ready", { timeout: 15_000 });
    await expect(queueDock(page)).toBeHidden();
    await toastOpen(page).click();
    await expect(page).toHaveURL(new RegExp(`/d/${ID}$`));
  });

  test("a failure names the step, keeps nothing changed, and Try again sends the same request", async ({
    page,
  }) => {
    const bodies = await mock(page, [
      {
        run_id: 91,
        state: "completed",
        step: "writing",
        outcome: "failed",
        run_url: "https://github.com/somesh-ks/knowledge-hub/actions/runs/91",
      },
      {
        run_id: 92,
        state: "running",
        step: "reading",
        stage: 1,
        stages: 7,
        label: "Gathering stories from your sources",
      },
    ]);
    await openRegenerate(page);
    await dialog(page).getByRole("button", { name: "Regenerate" }).click();

    await expect(text(page)).toHaveText("The podcast couldn't be written. Nothing was changed.", {
      timeout: 15_000,
    });
    const card = queueDock(page);
    // A failed run opens the dock, so its whole sentence and its three actions are in view.
    await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Details" })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Dismiss/ })).toBeVisible();
    // Try again and Details sit on one row under the sentence; the dismiss is in the ring's place, on
    // screen.
    const box = async (name: string, role: "button" | "link") =>
      (await card
        .getByRole(role, { name: name === "Dismiss" ? /^Dismiss/ : name })
        .boundingBox()) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    const [again, details, dismiss] = [
      await box("Try again", "button"),
      await box("Details", "link"),
      await box("Dismiss", "button"),
    ];
    expect(Math.abs(again.y - details.y)).toBeLessThan(4);
    const viewport = page.viewportSize()?.width ?? 0;
    expect(dismiss.x + dismiss.width).toBeLessThanOrEqual(viewport);

    await card.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);
    await expect(text(page)).toHaveText(/Waiting to start|Gathering stories/, {
      timeout: 15_000,
    });
  });

  // The 2026-10-28 ask: a Regenerate can be made longer or shorter than the schedule's length.
  test("a length chosen in the sheet goes with the request, and Try again sends it again", async ({
    page,
  }) => {
    const bodies = await mock(page, [
      { run_id: 91, state: "completed", step: "writing", outcome: "failed" },
      { run_id: 92, state: "running", step: "reading", stage: 1, stages: 7, label: "Gathering" },
    ]);
    await openRegenerate(page);
    // Usual is chosen until the person says otherwise: it asks for no length at all.
    await expect(dialog(page).getByRole("radio", { name: "Usual" })).toBeChecked();
    await dialog(page).getByRole("radio", { name: "10 min" }).check({ force: true });
    await dialog(page).getByRole("button", { name: "Regenerate" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ length_minutes: 10, replace: ID });

    await expect(text(page)).toHaveText("The podcast couldn't be written. Nothing was changed.", {
      timeout: 15_000,
    });
    await queueDock(page).getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);

    await expect(text(page)).toHaveText(/Waiting to start|Gathering/, { timeout: 15_000 });
  });

  test("a second run is not started while one is going, and the sheet says why", async ({
    page,
  }) => {
    const bodies = await mock(page, [
      {
        run_id: 91,
        state: "running",
        step: "reading",
        stage: 1,
        stages: 7,
        label: "Gathering stories from your sources",
      },
    ]);
    await openRegenerate(page);
    await dialog(page).getByRole("button", { name: "Regenerate" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(queueDock(page)).toBeVisible();

    await openRegenerate(page);
    await dialog(page).getByRole("button", { name: "Regenerate" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("still being made");
    expect(bodies).toHaveLength(1);
  });
});
