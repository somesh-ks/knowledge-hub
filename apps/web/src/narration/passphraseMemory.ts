/**
 * Where the narration passphrase is kept between requests.
 *
 * By default it lives in memory for the session, which is enough to narrate a whole briefing
 * without asking for it nineteen times. A listener who ticks "Remember on this device" has it kept
 * in the device's storage too, so the next briefing starts on one tap. It guards spending, not
 * private data, and a wrong one is forgotten as soon as the server says so.
 */
import type { PassphraseAnswer } from "./narrationController";

export const PASSPHRASE_STORAGE_KEY = "dispatch:narrate-passphrase";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PassphraseMemory {
  get(): string | null;
  set(answer: PassphraseAnswer): void;
  clear(): void;
}

/** `storage` is null where the device refuses storage (private mode); memory still works. */
export function createPassphraseMemory(storage: StorageLike | null): PassphraseMemory {
  let session: string | null = null;

  function stored(): string | null {
    try {
      return storage?.getItem(PASSPHRASE_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  function forget(): void {
    try {
      storage?.removeItem(PASSPHRASE_STORAGE_KEY);
    } catch {
      // Nothing was kept, so there is nothing to forget.
    }
  }

  return {
    get() {
      return session ?? stored();
    },
    set(answer) {
      session = answer.value;
      if (!answer.remember) {
        forget();
        return;
      }
      try {
        storage?.setItem(PASSPHRASE_STORAGE_KEY, answer.value);
      } catch {
        // Storage is full or refused: the session copy carries this briefing.
      }
    },
    clear() {
      session = null;
      forget();
    },
  };
}
