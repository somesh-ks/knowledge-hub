/**
 * Whether the owner passphrase is asked for before an action that spends credit or changes config:
 * narrating a briefing, creating an episode, generating a briefing, saving topics or sources.
 *
 * Off from 2026-10-08 (D41), on again since 2026-10-22 (D153): a shared link opens this site, so
 * whoever gets one must not be able to spend or edit. Each device is asked once and remembers it
 * (`dispatch:narrate-passphrase`); wrong guesses are capped across the routes (server/access.ts).
 * Set it to false to switch every prompt and every check off; no other change is needed.
 */
export const PASSPHRASE_REQUIRED = true;

/**
 * What the pages send in the passphrase field while it is not asked for. The server ignores it.
 * Sending a value keeps every request body, and every parser of one, the same in both modes.
 */
export const OPEN_PASSPHRASE = "open";
