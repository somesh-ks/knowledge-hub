import type { Locator, Page } from "@playwright/test";

/** The list a picker has open, whichever field opened it (scripts/picker.ts). */
export const pickerList = (page: Page) => page.locator(".picker-pop:popover-open");

/** Opens a picker's list from its button and presses the option with this name. */
export async function choose(page: Page, field: Locator, option: string | RegExp): Promise<void> {
  await field.click();
  await pickerList(page).getByRole("option", { name: option }).click();
}
