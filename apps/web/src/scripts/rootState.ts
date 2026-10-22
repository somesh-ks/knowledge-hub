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
 * case a listener cancelled the show. A swap brings a root without these, so they are said again.
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
  for (const element of document.querySelectorAll(`${selector}:popover-open`)) {
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
  new MutationObserver(syncDialog).observe(document.documentElement, {
    subtree: true,
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
