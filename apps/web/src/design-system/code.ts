/**
 * The Code snippet: text a person copies exactly as it is (a failed run's details, a prompt, an
 * error), in the monospace family, on a tonal box with a Copy button at its top end (owner,
 * 2026-11-05: the queue's failure details and the admin's prompts each drew their own). The one place
 * its classes are written; Code.astro renders from it, codeSnippetHtml builds it for a script, and
 * the rules are in styles/code.css. The text wraps, so a long line never scrolls sideways.
 */
import { escapeHtml, iconHtml } from "../lib/sheetHead";
import type { Guidance } from "./guidance";

export const CODE: Guidance = {
  summary: "Text to copy exactly as it is, in monospace, with a Copy button.",
  useWhen: [
    "A person copies the text to paste elsewhere: a failed run's details, a prompt, an error.",
    "Lines must keep their breaks and characters: an id, a log line, a config value.",
  ],
  dontUseWhen: [
    {
      when: "The text is read, not copied: a description, a status, an explanation.",
    },
    {
      when: "The person types or edits the text.",
      instead: "Field",
    },
  ],
};

/** Every class the Code snippet draws, for the registry and its test. */
export const CODE_CLASSES: string[] = ["code-snippet", "code-snippet-text", "code-snippet-copy"];

/** Classes the Code snippet replaced; none may be written again, in any app that draws the system. */
export const CODE_RETIRED: string[] = [];

/** How long the button shows its check before it offers the copy again. */
const COPIED_MS = 2000;

/** The words a snippet says; a page passes its own where it has them. */
export interface CodeWords {
  /** The text's accessible name, e.g. "Run details". */
  label: string;
  copy?: string;
  copied?: string;
}

/** A snippet's markup, for a script that builds a surface from a string (queueDetails.ts). */
export function codeSnippetHtml(text: string, words: CodeWords): string {
  const copy = escapeHtml(words.copy ?? "Copy");
  return (
    `<div class="code-snippet" data-code data-copied-word="${escapeHtml(words.copied ?? "Copied")}">` +
    `<pre class="code-snippet-text" tabindex="0" aria-label="${escapeHtml(words.label)}">${escapeHtml(text)}</pre>` +
    `<button class="icon-btn code-snippet-copy" type="button" aria-label="${copy}" title="${copy}" data-code-copy>` +
    `${iconHtml("copy", "lg")}${iconHtml("check", "lg")}</button>` +
    `<span class="sr-only" role="status" data-code-said></span></div>`
  );
}

/** Selects the snippet's text, so a person can copy it by hand where the clipboard is refused. */
function selectText(text: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(text);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

let wired = false;

/**
 * Copies a snippet's text when its button is pressed, for every snippet on the page now or later
 * (one listener on the document). The button shows a check and the status says Copied for two
 * seconds, with the success sound; with no clipboard (an insecure origin, a refused permission) the
 * text is selected instead.
 */
export function wireCodeCopy(): void {
  if (wired) return;
  wired = true;
  document.addEventListener("click", async (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-code-copy]");
    const snippet = button?.closest<HTMLElement>("[data-code]");
    const text = snippet?.querySelector<HTMLElement>(".code-snippet-text");
    if (!button || !snippet || !text) return;
    try {
      await navigator.clipboard.writeText(text.textContent ?? "");
    } catch {
      selectText(text);
      return;
    }
    const said = snippet.querySelector<HTMLElement>("[data-code-said]");
    snippet.dataset.copied = "";
    if (said) said.textContent = snippet.dataset.copiedWord ?? "Copied";
    document.dispatchEvent(new CustomEvent("singularity:sound", { detail: "success" }));
    clearTimeout(Number(snippet.dataset.copyTimer));
    snippet.dataset.copyTimer = String(
      setTimeout(() => {
        delete snippet.dataset.copied;
        if (said) said.textContent = "";
      }, COPIED_MS),
    );
  });
}
