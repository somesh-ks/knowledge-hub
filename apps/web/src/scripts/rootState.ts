/**
 * What the stylesheets used to ask of the whole page with a root `:has()` (an open dialog, a toast
 * on screen), said on <html> instead. A root `:has()` restyles the whole document whenever any
 * element might change its answer, which kept the first load's blocking time over budget (D147);
 * an attribute on the root restyles only the elements its rules name.
 *
 * - data-dialog-open: a <dialog> is open (foundations.css, shell.css, create-sheet.css and
 *   library.css).
 * - data-toast-open: a .toast popover shows (sheets.css); data-manage-toast-open: the saving toast
 *   (ManageChrome.astro) shows (manage.css).
 *
 * An open dialog is seen by its `open` attribute, before the frame is drawn. A popover is seen in
 * `beforetoggle`, which runs as it is shown or hidden; `toggle` checks again once it settled, in
 * case a listener cancelled the show. An open dialog or a showing toast taken out of the page fires
 * neither, so a removal checks both again. A swap brings a root without these, so they are said
 * again.
 */

const TOAST = ".toast";
const MANAGE_TOAST = ".manage-bar";

function setFlag(name: string, on: boolean): void {
  const root = document.documentElement;
  if (root.hasAttribute(name) !== on) root.toggleAttribute(name, on);
}

function syncDialog(): void {
  setFlag("data-dialog-open", document.querySelector("dialog[open]") !== null);
}

/** Whether a popover matching `selector` shows, with `changing` about to be `opening`. */
function popoverShows(selector: string, changing?: Element, opening = false): boolean {
  let open: NodeListOf<Element>;
  try {
    open = document.querySelectorAll(`${selector}:popover-open`);
  } catch {
    // Safari before 17 has no Popover API and throws on the selector; no toast is a popover there.
    return false;
  }
  for (const element of open) {
    if (element !== changing) return true;
  }
  return opening && changing?.matches(selector) === true;
}

function syncToasts(changing?: Element, opening = false): void {
  setFlag("data-toast-open", popoverShows(TOAST, changing, opening));
  setFlag("data-manage-toast-open", popoverShows(MANAGE_TOAST, changing, opening));
}

function sync(): void {
  syncDialog();
  syncToasts();
}

export function installRootState(): void {
  new MutationObserver((records) => {
    if (records.some((record) => record.type === "childList" && record.removedNodes.length > 0)) {
      sync();
    } else syncDialog();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributeFilter: ["open"],
  });
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(TOAST)) return;
      syncToasts(target, (event as ToggleEvent).newState === "open");
    },
    { capture: true },
  );
  document.addEventListener(
    "toggle",
    (event) => {
      if (event.target instanceof Element && event.target.matches(TOAST)) syncToasts();
    },
    { capture: true },
  );
  document.addEventListener("astro:after-swap", sync);
  sync();
}
