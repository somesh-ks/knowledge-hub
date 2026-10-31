/**
 * The Dialog: the small yes-or-no box that opens over the page, centred at every width, for one
 * question and its answers. The one place its classes are written. Dialog.astro and DialogActions.astro
 * render from it; a script or a React island that draws one calls dialogClass(), dialogBodyClass() and
 * dialogActionsClass(), and a script that finds one reads DIALOG_SELECTOR; the style guide lists DIALOG.
 * The rules are in styles/dialog.css. A form in a panel that slides in is a Sheet, not a Dialog.
 */
import type { Guidance } from "./guidance";

export const DIALOG: Guidance = {
  summary: "A small centred box with a heading and a row of buttons: one question, one tap.",
  useWhen: ["A person confirms what cannot be undone: Delete, Discard, Switch profile."],
  dontUseWhen: [
    {
      when: "The question needs fields to answer.",
      instead: "Sheet",
    },
  ],
};

/** Every class the Dialog draws, for the registry and its test. */
export const DIALOG_CLASSES: string[] = [
  "dialog-panel",
  "dialog-body",
  "dialog-actions",
  "dialog-actions-stacked",
];

/** Classes the Dialog replaced; none may be written again, in any app that draws the system. */
export const DIALOG_RETIRED: string[] = [
  "dialog-title",
  "confirm-dialog",
  "confirm-form",
  "confirm-actions",
  "is-stacked",
];

/** A script finds a dialog by this, never by a class. */
export const DIALOG_SELECTOR = "dialog[data-dialog]";

/** The class that draws the `<dialog>` itself. It also carries `data-dialog`. */
export const dialogClass = (): string => "dialog-panel";

/** The class of the box inside it, a form when the dialog submits. */
export const dialogBodyClass = (): string => "dialog-body";

/** The question, as the dialog's one heading. */
export const dialogTitleClass = (): string => "text-heading";

/** The row of answers; `stacked` makes it a column with the committing one first. */
export const dialogActionsClass = (stacked = false): string =>
  stacked ? "dialog-actions dialog-actions-stacked" : "dialog-actions";
