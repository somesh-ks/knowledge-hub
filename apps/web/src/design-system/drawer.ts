/**
 * The Drawer: the Base UI islands' modal, Catch up's shape for a React form: the whole screen on a
 * phone, a panel at the right from 40rem, the Sheet's header row and Close on top. The one place its
 * classes are written; sheets/SheetFrame.tsx draws from it. The rules are in styles/drawer.css. A
 * panel drawn by Astro or a script is a Sheet. There is no bottom-sheet Drawer (2026-11-02).
 */
import type { Guidance } from "./guidance";

export const DRAWER: Guidance = {
  summary:
    "The island modal for a form: the whole screen on a phone, a panel at the right from 40rem, with Close in the header.",
  useWhen: ["A React island opens a form over the page, as Regenerate does."],
  dontUseWhen: [
    { when: "The sheet is drawn by Astro or a script.", instead: "Sheet" },
    { when: "One question and its answers.", instead: "Dialog" },
  ],
};

/** Every class the Drawer draws, for the registry and its test. */
export const DRAWER_CLASSES: string[] = [
  "drawer-scrim",
  "drawer-viewport",
  "drawer-popup",
  "drawer-panel",
];

/** Classes the Drawer replaced; none may be written again, in any app that draws the system. */
export const DRAWER_RETIRED: string[] = [
  "sheet-scrim",
  "sheet-viewport",
  "sheet-popup",
  "sheet-panel",
  "drawer-head",
];

export const drawerScrimClass = (): string => "drawer-scrim";
export const drawerViewportClass = (): string => "drawer-viewport";
export const drawerPopupClass = (): string => "drawer-popup";
export const drawerPanelClass = (): string => "drawer-panel";
