import type { Locator } from "@playwright/test";
import { PASSPHRASE_REQUIRED } from "../../lib/access";

export { PASSPHRASE_REQUIRED };

/** Why a test about the open path is skipped while the passphrase is asked for. */
export const PASSPHRASE_ON = "the passphrase step is on";

/** Types the passphrase into a sheet when the app asks for one. Nothing to do while it does not. */
export async function enterPassphrase(dialog: Locator, value = "secret"): Promise<void> {
  if (PASSPHRASE_REQUIRED) await dialog.getByLabel("Passphrase").fill(value);
}
