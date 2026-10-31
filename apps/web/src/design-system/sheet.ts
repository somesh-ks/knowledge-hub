/**
 * The Sheet: a form or a list in a panel that slides over the page, the whole screen on a phone and
 * a panel on the right from 40rem. The one place its classes are written. Sheet.astro renders from
 * it; a script that builds a header calls sheetHeadClass() and sheetTitleClass(), and a script that
 * finds a sheet reads SHEET_SELECTOR. The rules are in styles/sheet.css. A yes-or-no box is a Dialog;
 * the bottom sheet of the Base UI islands is the Drawer.
 */
import type { Guidance } from "./guidance";

export const SHEET: Guidance = {
  summary:
    "A panel that slides over the page for a form or a list: the whole screen on a phone, the right side from 40rem.",
  useWhen: [
    "A person fills in or edits something that needs room: New episode, a topic, a source.",
    "A list that opens over the page and is dismissed with a pull or a tap away.",
  ],
  dontUseWhen: [
    { when: "One question and its answers.", instead: "Dialog" },
    { when: "A short list of actions.", instead: "Menu" },
    { when: "A form in a Base UI island.", instead: "Drawer" },
  ],
};

/** Every class the Sheet draws, for the registry and its test. */
export const SHEET_CLASSES: string[] = ["sheet-side", "sheet-head", "sheet-body", "sheet-title"];

/** Classes the Sheet replaced; none may be written again, in any app that draws the system. */
/** `create-sheet` itself is not listed: create-sheet.css, the file name, would read as the class. */
export const SHEET_RETIRED: string[] = ["create-sheet-head", "create-sheet-body", "regen-sheet"];

/** A script finds a sheet by this, never by a class. */
export const SHEET_SELECTOR = "dialog[data-sheet]";
/** The New episode sheet, which createSheet.ts builds from its template. */
export const CREATE_SHEET_SELECTOR = 'dialog[data-sheet="create"]';
/** Every other sheet: the Topics panel, Regenerate, Block sources and the structure editor. */
export const PANEL_SHEET_SELECTOR = 'dialog[data-sheet="panel"]';

/** The class that draws the `<dialog>` itself. */
export const sheetClass = (): string => "sheet-side";

/** The scrolling box under the header. */
export const sheetBodyClass = (): string => "sheet-body";

/** The header row: the title at the start, Close at the end. */
export const sheetHeadClass = (): string => "sheet-head";

/** The heading in that row, and in a Drawer's. */
export const sheetTitleClass = (): string => "sheet-title";
