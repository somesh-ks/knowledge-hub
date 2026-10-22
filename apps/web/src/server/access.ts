import { verifyPassphrase } from "@dispatch/core/passphrase";
import { windowOf } from "@dispatch/engine/rate-counter";
import { PASSPHRASE_REQUIRED } from "../lib/access";
import { type SharedLimiter, sharedLimit } from "./rateLimit";

export type PassphraseCheck = typeof verifyPassphrase;

/**
 * The passphrase check every route hands to its handler: the real comparison, or one that lets a
 * request through while the passphrase step is switched off (see lib/access.ts). The handlers
 * themselves do not change, so switching back needs nothing here.
 */
export function passphraseCheck(required: boolean = PASSPHRASE_REQUIRED): PassphraseCheck {
  return required ? verifyPassphrase : async () => true;
}

/** How long a wrong passphrase waits before its answer, so guessing one by one is slow. */
export const WRONG_PASSPHRASE_DELAY_MS = 750;

/**
 * Wrong passphrases a minute, on every route that takes one, counted together across instances in
 * the D150 counter. Past it, a request is refused before its passphrase is checked (D153).
 */
export const WRONG_GUESSES_PER_MINUTE = 10;
const MINUTE_MS = 60_000;

export interface GuessGate {
  /** 0 to check the passphrase, or the seconds until this instance checks one again. */
  wait(): number;
  /** Counts a wrong passphrase; past the cap, this instance stops checking until the minute ends. */
  failed(): Promise<void>;
}

/**
 * The cap on wrong guesses. A right passphrase never touches the counter, so the owner's requests
 * pay nothing for it. The counter can only take a slot, not look, so an instance learns the minute
 * is full from its own next wrong guess: past the cap each instance checks at most one more
 * passphrase a minute, and none of the expensive scrypt work is done for the rest.
 */
export function createGuessGate(
  limit: SharedLimiter = sharedLimit,
  perMinute = WRONG_GUESSES_PER_MINUTE,
  now: () => number = Date.now,
): GuessGate {
  let closed = -1;
  return {
    wait() {
      const at = now();
      if (windowOf(at, MINUTE_MS) !== closed) return 0;
      return Math.max(1, Math.ceil((MINUTE_MS - (at % MINUTE_MS)) / 1000));
    },
    async failed() {
      if (!(await limit("passphrase-fail", perMinute))) closed = windowOf(now(), MINUTE_MS);
    },
  };
}

/** The site's gate, one per instance, shared by the four routes that take a passphrase. */
export const guessGate: GuessGate = createGuessGate();

export interface PassphraseDeps {
  verifyPassphrase: PassphraseCheck;
  delay: (milliseconds: number) => Promise<void>;
  /** The cap on wrong guesses; left out, every passphrase is checked. */
  guesses?: GuessGate;
}

type PassphraseRefusal =
  | { status: 401; body: { status: 401; error: "wrong_passphrase" } }
  | {
      status: 429;
      headers: { "Retry-After": string };
      body: { status: 429; error: "cooldown"; retry_after_s: number };
    };

/**
 * A handler's passphrase step: null to go on, or the answer to give. While the gate is closed the
 * answer is a 429 `cooldown`, which every page already explains as a wait, never a 401: a 401 makes
 * a page forget its remembered passphrase, and someone else's guesses must not cost the owner that.
 */
export async function refusePassphrase(
  passphrase: string,
  storedHash: string,
  deps: PassphraseDeps,
): Promise<PassphraseRefusal | null> {
  const wait = deps.guesses?.wait() ?? 0;
  if (wait > 0) {
    return {
      status: 429,
      headers: { "Retry-After": String(wait) },
      body: { status: 429, error: "cooldown", retry_after_s: wait },
    };
  }
  if (await deps.verifyPassphrase(passphrase, storedHash)) return null;
  await deps.guesses?.failed();
  await deps.delay(WRONG_PASSPHRASE_DELAY_MS);
  return { status: 401, body: { status: 401, error: "wrong_passphrase" } };
}
