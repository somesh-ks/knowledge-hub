/**
 * The seam between the narration code, which needs a passphrase, and the sheet that asks for one.
 * One question at a time: the sheet reads the pending question and answers it once.
 */
import { requestSheet } from "../sheets/sheetEvents";
import type { PassphraseAnswer } from "./narrationController";

interface Question {
  wrong: boolean;
  resolve(answer: PassphraseAnswer | null): void;
}

let pending: Question | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Opens the sheet and resolves with the answer, or null when the listener closes it. */
export function askPassphrase(context: { wrong: boolean }): Promise<PassphraseAnswer | null> {
  // A question still open is closed unanswered: only the newest one matters.
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { wrong: context.wrong, resolve };
    emit();
    requestSheet("narrate");
  });
}

export function answerPassphrase(answer: PassphraseAnswer | null): void {
  const question = pending;
  pending = null;
  question?.resolve(answer);
  emit();
}

/** Whether the question being asked follows a wrong answer, or null when nothing is asked. */
export function pendingQuestion(): { wrong: boolean } | null {
  return pending ? { wrong: pending.wrong } : null;
}

export function subscribeQuestion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
