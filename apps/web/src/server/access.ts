import { verifyPassphrase } from "@dispatch/core/passphrase";
import { PASSPHRASE_REQUIRED } from "../lib/access";

export type PassphraseCheck = typeof verifyPassphrase;

/**
 * The passphrase check every route hands to its handler: the real comparison, or one that lets a
 * request through while the passphrase step is switched off (see lib/access.ts). The handlers
 * themselves do not change, so switching back needs nothing here.
 */
export function passphraseCheck(required: boolean = PASSPHRASE_REQUIRED): PassphraseCheck {
  return required ? verifyPassphrase : async () => true;
}
