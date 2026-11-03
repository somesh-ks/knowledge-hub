import { currentReadyView, setReady } from "../lib/readyNotice";

/**
 * The "Notify me when it's ready" row of a sheet drawn by Astro (ReadyNotice.astro): shown when this
 * browser can deliver, and read again each time the sheet opens, since Settings can change it.
 */
export function installReadyNotice(root: ParentNode, dialog?: HTMLDialogElement | null): void {
  const row = root.querySelector<HTMLElement>("[data-ready-notice]");
  const input = row?.querySelector<HTMLInputElement>("input");
  if (!row || !input || row.dataset.bound !== undefined) return;
  row.dataset.bound = "";
  const refresh = (): void => {
    const view = currentReadyView();
    row.hidden = !view.show;
    input.checked = view.checked;
  };
  refresh();
  input.addEventListener("change", () => {
    input.disabled = true;
    void setReady(input.checked).then((view) => {
      input.disabled = false;
      row.hidden = !view.show;
      input.checked = view.checked;
    });
  });
  if (dialog) {
    new MutationObserver(() => {
      if (dialog.open) refresh();
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  }
}
