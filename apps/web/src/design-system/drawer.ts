/**
 * The Drawer: the Base UI islands' modal, a bottom sheet on a phone and a centred dialog from 40rem,
 * for Generate and the Settings sheet. The one place its classes are written; sheets/SheetFrame.tsx
 * draws from it. The rules are in styles/drawer.css. A panel that slides in from the right is a Sheet.
 */
import type { Guidance } from "./guidance";

export const DRAWER: Guidance = {
  summary:
    "The island modal: a bottom sheet on a phone, a centred dialog from 40rem, pulled down to dismiss.",
  useWhen: ["A React island opens a form over the page, as Generate and Settings do."],
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
  "drawer-head",
];

/** Classes the Drawer replaced; none may be written again, in any app that draws the system. */
export const DRAWER_RETIRED: string[] = [
  "sheet-scrim",
  "sheet-viewport",
  "sheet-popup",
  "sheet-panel",
];

export const drawerScrimClass = (): string => "drawer-scrim";
export const drawerViewportClass = (): string => "drawer-viewport";
export const drawerPopupClass = (): string => "drawer-popup";
export const drawerPanelClass = (): string => "drawer-panel";
export const drawerHeadClass = (): string => "drawer-head";
