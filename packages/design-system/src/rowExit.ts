/**
 * The Row exit: how a row leaves a list the reader removes it from. The one place its class is
 * written. RowExit.astro renders the <li> from it; the style guide lists ROW_EXIT. The rules are in styles/row-exit.css.
 */
import type { Guidance } from "./guidance";

export const ROW_EXIT: Guidance = {
  summary:
    "A removed row fades out and then closes its gap, so the rows below slide up instead of jumping.",
  useWhen: [
    "A row in a list is removed on a press and Undo is in the toast: a blocked outlet, a source.",
    "A script marks the row data-removing or data-gone to take it out of the list.",
  ],
  dontUseWhen: [
    {
      when: "The thing is not a row in a list, such as a card, a dialog or a sheet closing.",
    },
    {
      when: "A row is filtered out by a search box, which must answer on the keystroke.",
    },
  ],
};

/** Every class the Row exit draws, for the registry and its test. */
export const ROW_EXIT_CLASSES: string[] = ["row-exit"];

/** Classes the Row exit replaced; none may be written again. */
export const ROW_EXIT_RETIRED: string[] = [];

/** The class that gives a row its exit. */
export const rowExitClass = (): string => "row-exit";
