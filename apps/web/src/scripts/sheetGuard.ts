import { buttonClass } from "../design-system/button";
import { dialogActionsClass, dialogBodyClass, dialogClass } from "../design-system/dialog";
import { dismissOnScrim } from "./pullDismiss";

/**
 * The unsaved-changes guard every edit sheet shares (2026-10-25). A sheet saves only with its own
 * Save button; nothing saves on an outside click. When the form differs from what it opened with,
 * the scrim, the Close button, Escape, a pull down and browser Back all ask "Save changes?" in the
 * confirm dialog (dialog.ts, dialog.css) instead of closing: Save, Discard or Keep
 * editing. A sheet with nothing changed closes at once.
 */

export interface SheetGuardOptions {
  /** True when the sheet holds changes it has not saved. */
  dirty(): boolean;
  /** Saves what the sheet holds. False when it could not (a field to fix): the sheet stays open. */
  save(): boolean;
}

export interface SheetGuard {
  /** Something asked to close the sheet: closes it, or asks first when it is dirty. */
  request(): void;
  dirty(): boolean;
  /**
   * Browser Back was pressed. When dirty it asks and returns true: the sheet keeps its history
   * entry (the caller pushes it again, as the pop took it). Otherwise false, and the caller closes.
   */
  holdBack(): boolean;
}

/** What the sheet's fields hold now: compared with the same read taken as it opened. */
export function formState(root: ParentNode): string {
  const fields = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, select, textarea",
  );
  return JSON.stringify(
    [...fields].map((field) =>
      field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")
        ? field.checked
        : field.value,
    ),
  );
}

/** A guard whose dirty test is the sheet's fields differing from now (call once the sheet is filled in). */
export function fieldsDirty(root: ParentNode): () => boolean {
  const opened = formState(root);
  return () => formState(root) !== opened;
}

let serial = 0;

export function guardSheet(sheet: HTMLDialogElement, options: SheetGuardOptions): SheetGuard {
  let asking: HTMLDialogElement | null = null;

  /** A pull that did not close the sheet puts it back where it was. */
  const settleBack = (): void => {
    const offset = sheet.style.translate;
    sheet.style.translate = "";
    if (!offset || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    sheet.animate([{ translate: offset }, { translate: "0 0" }], {
      duration: 240,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  };

  const ask = (): void => {
    if (asking?.isConnected) return;
    serial += 1;
    const id = `sheet-guard-${serial}`;
    const dialog = document.createElement("dialog");
    dialog.className = dialogClass();
    dialog.dataset.dialog = "";
    dialog.setAttribute("aria-labelledby", id);
    dialog.dataset.sheetGuard = "";
    // Fixed markup: nothing from the page goes into it.
    dialog.innerHTML = `<div class="${dialogBodyClass()}">
      <h2 class="sheet-title">Save changes?</h2>
      <div class="${dialogActionsClass(true)}">
        <button class="${buttonClass("filled")}" type="button" data-guard-save autofocus>Save</button>
        <button class="${buttonClass("text")}" type="button" data-guard-discard>Discard</button>
        <button class="${buttonClass("text")}" type="button" data-guard-keep>Keep editing</button>
      </div>
    </div>`;
    const heading = dialog.querySelector("h2");
    if (heading) heading.id = id;
    const done = (): void => {
      dialog.close();
      window.setTimeout(() => dialog.remove(), 400);
    };
    dialog.addEventListener("click", (event) => {
      const button = (event.target as Element).closest("button");
      if (!button) return;
      if ("guardKeep" in button.dataset) done();
      else if ("guardDiscard" in button.dataset) {
        done();
        sheet.close();
      } else if ("guardSave" in button.dataset) {
        const saved = options.save();
        done();
        if (saved && sheet.open) sheet.close();
      }
    });
    dialog.addEventListener("close", () => {
      asking = null;
    });
    dismissOnScrim(dialog, done);
    asking = dialog;
    document.body.append(dialog);
    dialog.showModal();
  };

  const request = (): void => {
    if (!sheet.open) return;
    if (!options.dirty()) {
      sheet.close();
      return;
    }
    settleBack();
    ask();
  };

  // Escape: the dialog's own cancel would close it and drop the changes.
  sheet.addEventListener("cancel", (event) => {
    if (!options.dirty()) return;
    event.preventDefault();
    request();
  });

  return {
    request,
    dirty: options.dirty,
    holdBack() {
      // A sheet already closed (Save, then the pop its entry causes) has nothing left to ask about.
      if (!sheet.open || !options.dirty()) return false;
      ask();
      return true;
    },
  };
}
