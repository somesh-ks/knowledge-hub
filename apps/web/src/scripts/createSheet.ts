import { installCreate } from "./createPage";

/**
 * The Create sheet: a native dialog cloned from the layout's template on first open (the markup is
 * the Create form component, the same one /create renders), opened as a modal. Loaded on the first
 * press of a Create button, never with the page. It does not outlive a navigation; the next press
 * builds it again. Escape closes it, and focus goes back to the button that opened it.
 */
const SELECTOR = "dialog.create-sheet";

function build(): HTMLDialogElement | null {
  const template = document.getElementById("create-sheet-template");
  const clone = (template as HTMLTemplateElement | null)?.content.firstElementChild?.cloneNode(true);
  if (!(clone instanceof HTMLDialogElement)) return null;
  document.body.append(clone);
  const root = clone.querySelector<HTMLElement>("[data-create]");
  // A started run closes the sheet; the form is then spent, so the next press builds a fresh one.
  if (root) installCreate(root, () => ((clone.dataset.started = ""), clone.close()));
  clone.querySelector("[data-create-close]")?.addEventListener("click", () => clone.close());
  // A press on the scrim lands on the dialog itself; everything else is inside its panel.
  clone.addEventListener("click", (event) => {
    if (event.target === clone) clone.close();
  });
  return clone;
}

export function openCreateSheet(trigger: HTMLElement | null): void {
  let dialog = document.querySelector<HTMLDialogElement>(SELECTOR);
  if (dialog && "started" in dialog.dataset) {
    dialog.remove();
    dialog = null;
  }
  dialog ??= build();
  if (!dialog || dialog.open) return;
  const back = () => trigger?.isConnected && trigger.focus();
  dialog.addEventListener("close", back, { once: true });
  dialog.showModal();
}
