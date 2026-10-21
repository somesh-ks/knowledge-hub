import { installCreate } from "./createPage";
import { sheetGestures } from "./pullDismiss";

/**
 * The Create sheet: a native dialog cloned from the layout's template on first open (the markup is
 * the Create form component, the same one /create renders), opened as a modal. Loaded on the first
 * press of a Create button, never with the page. It does not outlive a navigation; the next press
 * builds it again. Escape closes it, and focus goes back to the button that opened it.
 */
// The episode page's rewrite panel wears the same class for its looks; it is not this sheet.
const SELECTOR = "dialog.create-sheet:not(.regen-sheet)";

function build(): HTMLDialogElement | null {
  const template = document.getElementById("create-sheet-template");
  const clone = (template as HTMLTemplateElement | null)?.content.firstElementChild?.cloneNode(
    true,
  );
  if (!(clone instanceof HTMLDialogElement)) return null;
  document.body.append(clone);
  const root = clone.querySelector<HTMLElement>("[data-create]");
  // A started run closes the sheet; the form is then spent, so the next press builds a fresh one.
  if (root) {
    installCreate(root, () => {
      clone.dataset.started = "";
      clone.close();
    });
  }
  clone.querySelector("[data-create-close]")?.addEventListener("click", () => clone.close());
  // The header takes a tone once the form has scrolled under it, and the foot shows its edge while
  // more of the form runs on below it (create-sheet.css). The form grows as More options opens.
  const body = clone.querySelector<HTMLElement>(".create-sheet-body");
  if (body) {
    const edges = () => {
      clone.toggleAttribute("data-scrolled", body.scrollTop > 0);
      clone.toggleAttribute(
        "data-more",
        body.scrollTop + body.clientHeight < body.scrollHeight - 1,
      );
    };
    body.addEventListener("scroll", edges, { passive: true });
    const sizes = new ResizeObserver(edges);
    sizes.observe(body);
    if (body.firstElementChild) sizes.observe(body.firstElementChild);
  }
  // Pulled down on a phone, or tapped on the scrim, it closes (pullDismiss.ts).
  sheetGestures(clone);
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
  const sheet = dialog;
  const refocus = () => trigger?.isConnected && trigger.focus();
  // Browser Back closes the sheet and stays on the page. The sheet takes one history entry. The
  // head script (themeInit.js) asks first on every pop; answering "handled" keeps Astro's router
  // from re-rendering the page for it.
  let entry = true;
  const onBack = (event: Event) => {
    if (!entry) return;
    entry = false;
    event.preventDefault();
    removeEventListener("dispatch:back", onBack);
    if (sheet.open) sheet.close();
  };
  history.pushState({ ...history.state, createSheet: true }, "");
  addEventListener("dispatch:back", onBack);
  sheet.addEventListener(
    "close",
    () => {
      refocus();
      // Closed any other way: give the entry back. The pop this causes is swallowed too.
      if (entry) history.go(-1);
    },
    { once: true },
  );
  sheet.showModal();
}
