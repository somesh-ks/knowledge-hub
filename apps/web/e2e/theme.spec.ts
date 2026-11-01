import type { Page } from "@playwright/test";
import { computedColor, expectColor, SURFACE_DARK, SURFACE_LIGHT } from "./colors";
import { expect, test } from "./fixtures";

const bodyBackground = (page: Page) => computedColor(page.locator("body"), "backgroundColor");

/** Records the theme the moment the body first exists, which is before anything can be painted. */
async function recordThemeAtBodyStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      (window as unknown as { __themeAtBody: string | null }).__themeAtBody =
        document.documentElement.getAttribute("data-theme");
      observer.disconnect();
    });
    // The document element does not exist yet when this runs, so watch the document itself.
    observer.observe(document, { childList: true, subtree: true });
  });
}

test.describe("theme", () => {
  // (stored choice, system scheme, expected theme): a stored choice wins, before first paint, and
  // anything else follows the system.
  const cases = [
    { stored: null, system: "dark", theme: null },
    { stored: "dark", system: "light", theme: "dark" },
    { stored: "light", system: "dark", theme: "light" },
    { stored: "sepia", system: "light", theme: null },
  ] as const;
  for (const { stored, system, theme } of cases) {
    test(`stored ${stored ?? "nothing"} on a ${system} system shows ${theme ?? "the system"}, from first paint`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: system });
      if (stored) {
        await page.addInitScript(
          (value) =>
            localStorage.setItem("singularity:preferences", JSON.stringify({ theme: value })),
          stored,
        );
      }
      await recordThemeAtBodyStart(page);
      await page.goto("/");
      expect(
        await page.evaluate(
          () => (window as unknown as { __themeAtBody: string | null }).__themeAtBody,
        ),
      ).toBe(theme);
      if (theme) await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      else await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
      const shown = theme ?? system;
      await expectColor(
        page,
        await bodyBackground(page),
        shown === "dark" ? SURFACE_DARK : SURFACE_LIGHT,
      );
    });
  }

  test("survives a client-side navigation", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() =>
      localStorage.setItem("singularity:preferences", JSON.stringify({ theme: "dark" })),
    );
    await page.goto("/");
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectColor(page, await bodyBackground(page), SURFACE_DARK);
  });

  test("a theme set while the page is open also survives navigation", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    // Through the real control. Writing storage behind the app's back raced the player's own copy
    // of the preferences, and passed or failed by which loaded first.
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // And it is still there on the page after that.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Latest", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
  test("a style chosen in Settings survives navigation and a reload, set before first paint", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page.getByRole("combobox", { name: "Style" }).selectOption("expressive");
    await expect(page.locator("html")).toHaveAttribute("data-style", "expressive");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-style", "expressive");
    // A reload: the attribute is on the document by the time the body exists, so nothing is painted
    // in Default first.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        (window as unknown as { __styleAtBody: string | null }).__styleAtBody =
          document.documentElement.getAttribute("data-style");
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    expect(
      await page.evaluate(
        () => (window as unknown as { __styleAtBody: string | null }).__styleAtBody,
      ),
    ).toBe("expressive");
    // Back to Default removes the attribute rather than leaving a stale one.
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page.getByRole("combobox", { name: "Style" }).selectOption("default");
    await expect(page.locator("html")).not.toHaveAttribute("data-style", /.*/);
  });

  test("a style recolours the covers already on the page, with no cover fetched, and Default returns them", async ({
    page,
  }) => {
    const fill = () =>
      page.evaluate(() => {
        const slot = document.querySelector(".cover-art .k");
        return slot ? getComputedStyle(slot).fill : null;
      });
    const covers: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/covers/")) covers.push(request.url());
    });
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(page.locator(".cover-art").first()).toBeVisible();
    const inDefault = await fill();
    expect(inDefault).not.toBeNull();
    // The covers are on the page when the style changes; the same elements take new colours.
    await page.evaluate(() => {
      document.documentElement.dataset.style = "expressive";
    });
    const before = covers.length;
    await expect.poll(fill).not.toBe(inDefault);
    expect(covers.length).toBe(before);
    await page.evaluate(() => {
      delete document.documentElement.dataset.style;
    });
    await expect.poll(fill).toBe(inDefault);
  test("the Hue slider turns a style's colours, is there before first paint after a reload, and waits for a style", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    const hue = page.getByRole("slider", { name: "Hue" });
    // Default is blue and has no hue to turn.
    await expect(hue).toBeDisabled();
    await page.getByRole("combobox", { name: "Style" }).selectOption("expressive");
    await expect(hue).toBeEnabled();
    const surface = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const designed = await surface();
    await hue.fill("180");
    await expect.poll(surface).not.toBe(designed);
    const turned = await surface();
    // A reload: the turn is on the root by the time the body exists, so the page is not drawn at the
    // designed hue first.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        (window as unknown as { __hueAtBody: string }).__hueAtBody =
          document.documentElement.style.getPropertyValue("--hue-shift");
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { __hueAtBody: string }).__hueAtBody),
    ).toBe("180");
    expect(await surface()).toBe(turned);
    // Default carries no turn, and the slider waits again.
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page.getByRole("combobox", { name: "Style" }).selectOption("default");
    await expect(hue).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.style.getPropertyValue("--hue-shift")),
    ).toBe("");
  });

  test("Halloween swaps in its own scene and a cobweb that takes no tap; Default shows only its own", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page.getByRole("combobox", { name: "Style" }).selectOption("halloween");
    await page.goto("/no/such/page");
    const root = page.locator("#main .empty");
    await expect(root.locator('.empty-art[data-look="halloween"]')).toBeVisible();
    await expect(root.locator('.empty-art[data-art="notfound"]')).toBeHidden();
    await expect(page.locator(".cobweb")).toBeVisible();
    // The cobweb hangs in the top-right corner; a tap there reaches what is under it.
    const corner = await page.evaluate(
      () => document.elementFromPoint(window.innerWidth - 12, 12)?.closest(".cobweb") ?? null,
    );
    expect(corner).toBeNull();
    // Back to Default: its own scene returns and the ornament goes.
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page.getByRole("combobox", { name: "Style" }).selectOption("default");
    await page.goto("/no/such/page");
    await expect(root.locator('.empty-art[data-art="notfound"]')).toBeVisible();
    await expect(root.locator('.empty-art[data-look="halloween"]')).toBeHidden();
    await expect(page.locator(".cobweb")).toBeHidden();
  });
});
