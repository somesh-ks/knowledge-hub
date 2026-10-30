import { buttonClass } from "../design-system/button";
import { escapeHtml, sheetHeadHtml } from "../lib/sheetHead";
import { dismissOnScrim } from "./pullDismiss";

/** How long the button says "Copied" before it offers the copy again. */
const COPIED_MS = 2000;

/** What a failed run's Details dialog shows (scripts/queue.ts builds it from the run's record). */
export interface QueueDetails {
  /** What went wrong, in a sentence a person can read. */
  what: string;
  /** Why, in the engine's own sentence, when it gave one. */
  why: string;
  /** What is known of the run, as `Name: value` lines in the snippet. */
  fields: [name: string, value: string][];
  /** The run's log on GitHub, where the full error is; "" when there is none. */
  log: string;
}

/** The snippet's text: one `Name: value` line for each field that has a value. */
export const detailsSnippet = (fields: QueueDetails["fields"]): string =>
  fields
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");

/**
 * Details of a failed run (2026-10-29): what went wrong in plain words and what to do, then the facts of
 * the run as a snippet with a Copy button, so the person can paste them where they ask for help. The dialog is
 * the share dialog's own shape (shareDialog.ts), built on demand; the words come from the queue's
 * data attributes.
 */
export function openQueueDetails(details: QueueDetails, words: DOMStringMap): void {
  document.querySelector("dialog.queue-details-dialog")?.remove();
  const snippet = detailsSnippet(details.fields);
  const dialog = document.createElement("dialog");
  dialog.className = "share-dialog queue-details-dialog";
  dialog.setAttribute("aria-labelledby", "queue-details-title");
  dialog.innerHTML =
    `${sheetHeadHtml(words.wordDetailsTitle ?? "", "queue-details-title", "data-dialog-close")}` +
    `<p class="share-about">${escapeHtml([details.what, details.why].filter(Boolean).join(" "))}</p>` +
    `<p class="share-about">${escapeHtml(words.wordDetailsHint ?? "")}</p>` +
    `<pre class="queue-snippet" tabindex="0" data-queue-snippet>${escapeHtml(snippet)}</pre>` +
    `<div class="share-actions queue-details-actions">` +
    (details.log
      ? `<a class="${buttonClass("text")}" href="${escapeHtml(details.log)}" target="_blank" rel="noopener noreferrer">${escapeHtml(words.wordDetailsLog ?? "")}</a>`
      : "") +
    `<button class="${buttonClass("filled")}" type="button" data-queue-copy>${escapeHtml(words.wordDetailsCopy ?? "")}</button></div>` +
    `<span class="sr-only" role="status" data-queue-copied></span>`;
  document.body.append(dialog);

  const pre = dialog.querySelector<HTMLElement>("[data-queue-snippet]");
  const copy = dialog.querySelector<HTMLButtonElement>("[data-queue-copy]");
  const said = dialog.querySelector<HTMLElement>("[data-queue-copied]");
  let timer: ReturnType<typeof setTimeout> | undefined;

  dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close());
  dismissOnScrim(dialog);
  copy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      // No clipboard here (an insecure origin, a denied permission): the snippet is selected to copy by hand.
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return;
    }
    const label = words.wordDetailsCopy ?? "";
    copy.textContent = words.wordDetailsCopied ?? "";
    if (said) said.textContent = words.wordDetailsCopied ?? "";
    document.dispatchEvent(new CustomEvent("singularity:sound", { detail: "success" }));
    clearTimeout(timer);
    timer = setTimeout(() => {
      copy.textContent = label;
      if (said) said.textContent = "";
    }, COPIED_MS);
  });
  dialog.addEventListener("close", () => {
    clearTimeout(timer);
    dialog.remove();
  });
  dialog.showModal();
  copy?.focus();
}
