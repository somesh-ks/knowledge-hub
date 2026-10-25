import { escapeHtml, sheetHeadHtml } from "../lib/sheetHead";
import { dismissOnScrim } from "./pullDismiss";

/** How long the button says "Copied" before it offers the copy again. */
const COPIED_MS = 2000;

/**
 * Share: a small dialog with the link in a read-only field, a Copy link button that says "Copied" for a
 * moment, and Close (2026-10-25, instead of the system sheet or a bare copy). Built on demand, so
 * every page that can share has it. Resolves "copied" if the link was copied while it was open.
 */
export function openShareDialog(title: string, url: string): Promise<"copied" | "none"> {
  document.querySelector("dialog.share-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.className = "share-dialog";
  dialog.setAttribute("aria-labelledby", "share-title");
  dialog.innerHTML =
    `${sheetHeadHtml("Share link", "share-title", "data-dialog-close")}` +
    `<p class="share-about">${escapeHtml(title)}</p>` +
    `<input class="share-url" type="text" readonly value="${escapeHtml(url)}" aria-label="Link" />` +
    `<div class="share-actions"><button class="btn-primary" type="button" data-share-copy>Copy link</button></div>` +
    `<span class="sr-only" role="status" data-share-said></span>`;
  document.body.append(dialog);

  const field = dialog.querySelector<HTMLInputElement>(".share-url");
  const copy = dialog.querySelector<HTMLButtonElement>("[data-share-copy]");
  const said = dialog.querySelector<HTMLElement>("[data-share-said]");
  let copied = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolve) => {
    dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close());
    dismissOnScrim(dialog);
    field?.addEventListener("focus", () => field.select());
    copy?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // No clipboard here (an insecure origin, a denied permission): the field is selected to copy by hand.
        field?.focus();
        field?.select();
        return;
      }
      copied = true;
      copy.textContent = "Copied";
      if (said) said.textContent = "Link copied";
      document.dispatchEvent(new CustomEvent("singularity:sound", { detail: "success" }));
      clearTimeout(timer);
      timer = setTimeout(() => {
        copy.textContent = "Copy link";
        if (said) said.textContent = "";
      }, COPIED_MS);
    });
    dialog.addEventListener("close", () => {
      clearTimeout(timer);
      dialog.remove();
      resolve(copied ? "copied" : "none");
    });
    dialog.showModal();
    // The link is what the person came for: selected, so a keyboard copy works at once.
    field?.select();
  });
}
