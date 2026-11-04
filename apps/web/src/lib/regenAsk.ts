import { type Answer, NO_ANSWER, type Values } from "./regenFollow";
import type { Hints } from "./regenHints";

/** How long the typing must rest before the models are asked: a pause, not every keystroke. */
const PAUSE_MS = 800;
/** Fewer characters than this say too little to read. */
const MIN_CHARS = 8;

const isHints = (body: unknown): body is Hints =>
  typeof body === "object" && body !== null && "length" in body && "topics" in body;

const isValues = (body: unknown): body is Values =>
  typeof body === "object" &&
  body !== null &&
  "add" in body &&
  Array.isArray(body.add) &&
  "length" in body &&
  (body.length === null || body.length === "shorter" || body.length === "longer");

/**
 * Asks the site, once the typing pauses, what the comment calls for: which controls, as Jev reads
 * it (D370), and what to set them to, as Haiku reads it (D371, api/regen-hints). The word match
 * has already answered at once. Each pause cancels the ask before it, the same words are never
 * asked twice, and a failure is silent: the word match stands. The answer follows the comment both
 * ways: it is kept until the next one replaces it, and a comment cleared away empties it, so the
 * controls go with the words.
 */
export function createCommentAsker(onAnswer: (answer: Answer) => void): {
  note: (text: string, labels: readonly string[]) => void;
  stop: () => void;
  answer: () => Answer;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;
  let asked = "";
  let answer: Answer = NO_ANSWER;

  const set = (next: Answer): void => {
    answer = next;
    onAnswer(next);
  };

  // An ask cut off before its answer is forgotten, so the same words can be asked again.
  const cancel = (): void => {
    clearTimeout(timer);
    if (!pending) return;
    pending.abort();
    pending = undefined;
    asked = "";
  };

  // A closed sheet starts afresh: the words it asked and the answer are forgotten too, so a
  // comment typed again into the next opening is read again.
  const stop = (): void => {
    cancel();
    asked = "";
    answer = NO_ANSWER;
  };

  const note = (text: string, labels: readonly string[]): void => {
    const comment = text.trim();
    // The words already asked (a trailing space added) leave that ask in flight alone.
    if (comment === asked) {
      clearTimeout(timer);
      return;
    }
    cancel();
    if (comment.length < MIN_CHARS) {
      asked = "";
      if (answer !== NO_ANSWER) set(NO_ANSWER);
      return;
    }
    timer = setTimeout(() => {
      asked = comment;
      const controller = new AbortController();
      pending = controller;
      const ask = (want: "show" | "values"): Promise<unknown> =>
        fetch("/api/regen-hints", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment, categories: labels, want }),
          signal: controller.signal,
        })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
      void ask("show").then((body) => {
        if (!controller.signal.aborted && isHints(body)) {
          set({ ...answer, hints: { length: body.length === true, topics: body.topics === true } });
        }
      });
      void ask("values").then((body) => {
        if (!controller.signal.aborted && isValues(body)) {
          set({
            ...answer,
            values: { length: body.length, add: body.add.filter((n) => typeof n === "string") },
          });
        }
      });
    }, PAUSE_MS);
  };

  return { note, stop, answer: () => answer };
}
