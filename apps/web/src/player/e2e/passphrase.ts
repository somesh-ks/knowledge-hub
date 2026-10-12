import type { Locator } from "@playwright/test";
import { PASSPHRASE_REQUIRED } from "../../lib/access";

export { PASSPHRASE_REQUIRED };

/** Types the passphrase into a sheet when the app asks for one. Nothing to do while it does not. */
export async function enterPassphrase(dialog: Locator, value = "secret"): Promise<void> {
  if (PASSPHRASE_REQUIRED) await dialog.getByLabel("Passphrase").fill(value);
}
