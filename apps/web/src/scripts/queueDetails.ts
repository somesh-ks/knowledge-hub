import { codeSnippetHtml, wireCodeCopy } from "../design-system/code";
import { escapeHtml, sheetHeadHtml } from "../lib/sheetHead";
import { dismissOnScrim } from "./pullDismiss";

/** What a failed run's Details dialog shows (scripts/queue.ts builds it from the run's record). */
export interface QueueDetails {
  /** What went wrong, in a sentence a person can read. */
  what: string;
  /** Why, in the engine's own sentence, when it gave one. */
  why: string;
  /** What is known of the run, as `Name: value` lines in the snippet. */
  fields: [name: string, value: string][];
}

/** The snippet's text: one `Name: value` line for each field that has a value. */
export const detailsSnippet = (fields: QueueDetails["fields"]): string =>
  fields
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");

/**
 * Details of a failed run (2026-10-29): what went wrong in plain words and what to do, then the facts of
 * the run as the design system's Code snippet (its own Copy button), so the person can paste them where they
 * ask for help. The dialog is the share dialog's own shape (shareDialog.ts), built on demand; the words come
 * from the queue's data attributes.
 */
export function openQueueDetails(details: QueueDetails, words: DOMStringMap): void {
  document.querySelector("dialog.queue-details-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.className = "share-dialog queue-details-dialog";
  dialog.setAttribute("aria-labelledby", "queue-details-title");
  dialog.innerHTML =
    `${sheetHeadHtml(words.wordDetailsTitle ?? "", "queue-details-title", "data-dialog-close")}` +
    `<p class="share-about">${escapeHtml([details.what, details.why].filter(Boolean).join(" "))}</p>` +
    `<p class="share-about">${escapeHtml(words.wordDetailsHint ?? "")}</p>` +
    `<div class="queue-details-snippet">${codeSnippetHtml(detailsSnippet(details.fields), {
      label: words.wordDetailsTitle ?? "",
      copy: words.wordDetailsCopy,
      copied: words.wordDetailsCopied,
    })}</div>`;
  document.body.append(dialog);
  wireCodeCopy();

  dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close());
  dismissOnScrim(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}
