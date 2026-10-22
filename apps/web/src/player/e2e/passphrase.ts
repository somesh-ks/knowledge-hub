import type { Locator } from "@playwright/test";
import { PASSPHRASE_REQUIRED } from "../../lib/access";

export { PASSPHRASE_REQUIRED };

/**
 * Types the passphrase into a sheet when it asks for one. An unlocked device (the default fixture,
 * D153) remembers one, and the sheet then shows no field: nothing to do.
 */
export async function enterPassphrase(dialog: Locator, value = "secret"): Promise<void> {
  const field = dialog.getByLabel("Passphrase");
  if (PASSPHRASE_REQUIRED && (await field.count()) > 0) await field.fill(value);
}
