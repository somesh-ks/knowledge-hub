import type { Locator } from "@playwright/test";
import { PASSPHRASE_REQUIRED } from "../src/lib/access";

export { PASSPHRASE_REQUIRED };

/** Why a test about the passphrase prompt is skipped while the step is off (lib/access.ts). */
export const PASSPHRASE_OFF = "the passphrase step is switched off (D41)";
/** Why a test about the open path is skipped while the passphrase is asked for. */
export const PASSPHRASE_ON = "the passphrase step is on";

/** Types the passphrase into a sheet when the app asks for one. Nothing to do while it does not. */
export async function enterPassphrase(dialog: Locator, value = "secret"): Promise<void> {
  if (PASSPHRASE_REQUIRED) await dialog.getByLabel("Passphrase").fill(value);
}
