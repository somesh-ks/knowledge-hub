/**
 * Whether the owner passphrase is asked for before an action that spends credit or changes config:
 * narrating a briefing, creating an episode, generating a briefing, saving topics or sources.
 *
 * Off since 2026-10-08, by the owner's decision (D41): "remove passphrase for now, but we can have
 * the code for future." While it is off, anyone who can open the site can start those actions,
 * inside the cooldowns, the daily caps and the monthly narration budget, which stay enforced.
 * Set it to true to bring every prompt and every check back; no other change is needed.
 */
export const PASSPHRASE_REQUIRED = false;

/**
 * What the pages send in the passphrase field while it is not asked for. The server ignores it.
 * Sending a value keeps every request body, and every parser of one, the same in both modes.
 */
export const OPEN_PASSPHRASE = "open";
