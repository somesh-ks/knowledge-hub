import type { Hints } from "./regenHints";

/** How long the typing must rest before Jev is asked: a pause, not every keystroke. */
const PAUSE_MS = 800;
/** Fewer characters than this say too little to read. */
const MIN_CHARS = 8;

/**
 * Asks the site, once the typing pauses, which Regenerate controls the comment calls for as Jev
 * reads it (D370, api/regen-hints). The word match has already answered at once; this only adds a
 * control it missed. Each pause cancels the ask before it, the same words are never asked twice,
 * and a failure is silent: the word match stands.
 */
export function createCommentAsker(onHints: (hints: Hints) => void): {
  note: (text: string, labels: readonly string[], shown: Hints) => void;
  stop: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AbortController | undefined;
  let asked = "";

  // An ask cut off before its answer is forgotten, so the same words can be asked again.
  const stop = (): void => {
    clearTimeout(timer);
    if (!pending) return;
    pending.abort();
    pending = undefined;
    asked = "";
  };

  const note = (text: string, labels: readonly string[], shown: Hints): void => {
    const comment = text.trim();
    // The words already asked (a trailing space added) leave that ask in flight alone.
    if (comment === asked) {
      clearTimeout(timer);
      return;
    }
    stop();
    if (comment.length < MIN_CHARS || (shown.length && shown.topics)) return;
    timer = setTimeout(() => {
      asked = comment;
      const controller = new AbortController();
      pending = controller;
      void fetch("/api/regen-hints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment, categories: labels }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          if (controller.signal.aborted || typeof body !== "object" || body === null) return;
          const { length, topics } = body as Partial<Hints>;
          if (length === true || topics === true) {
            onHints({ length: length === true, topics: topics === true });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (pending === controller) pending = undefined;
        });
    }, PAUSE_MS);
  };

  return { note, stop };
}
