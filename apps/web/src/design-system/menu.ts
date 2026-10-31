/**
 * The Menu: a popover list of actions, a small menu under its button from 40rem and a bottom sheet on
 * a phone, with a row for each action. The one place its classes are written. Menu.astro and
 * MenuItem.astro render from it; a script, a React island or a string builder that draws one calls
 * menuListClass() and menuItemClass(), and a script that finds one reads MENU_SELECTORS; the style
 * guide lists MENU. The rules are in styles/menu.css.
 */
import type { Guidance } from "./guidance";

export type MenuItemTone = "danger";

export const MENU: Guidance & {
  tones: Record<MenuItemTone, Guidance & { label: string }>;
} = {
  summary:
    "A short list of actions that opens from an icon button: a row each, with its glyph at the start.",
  useWhen: [
    "A card, a header or a row has more actions than it has room for: Download, Add to queue, Share, Delete.",
    "Each action is one tap and needs no choice of its own.",
  ],
  dontUseWhen: [
    {
      when: "The person picks one value from a list.",
      instead: "Select",
    },
    {
      when: "The only action is the one the button already names.",
      instead: "Button",
    },
  ],
  tones: {
    danger: {
      label: "Danger",
      summary: "A row in the danger colour for the one action that destroys.",
      useWhen: [
        "It deletes or removes something: Delete, Remove from queue.",
        "A confirm still asks before anything is removed.",
      ],
      dontUseWhen: [
        {
          when: "The action can be undone with one tap.",
          instead: "Menu",
        },
      ],
    },
  },
};

/** Every class the Menu draws, for the registry and its test. */
export const MENU_CLASSES: string[] = [
  "menu-list",
  "menu-sheet",
  "menu-sheet-items",
  "menu-item",
  "menu-item-danger",
];

/** Classes the Menu replaced; none may be written again, in any app that draws the system. */
export const MENU_RETIRED: string[] = ["hero-menu-list", "hero-menu-item", "hero-menu-delete"];

/** The selectors a script finds a menu by, so no script writes a class. */
export const MENU_SELECTORS = {
  list: ".menu-list",
  sheet: ".menu-list.menu-sheet",
  body: ".menu-sheet-items",
} as const;

/** The class that draws a menu's popover; `sheet` makes it a bottom sheet on a phone. */
export const menuListClass = (sheet = true): string =>
  sheet ? "menu-list menu-sheet" : "menu-list";

/** The sheet's own gap and icon rules alone, for a menu shown in place, not in the top layer. */
export const menuSheetClass = (): string => "menu-sheet";

/** The class that marks a menu's body inside a sheet: it scrolls past 70% of the screen, and the sheet's pull to dismiss finds it. */
export const menuBodyClass = (): string => "menu-sheet-items";

/** The class that draws a row of the menu. */
export const menuItemClass = (tone?: MenuItemTone): string =>
  tone === "danger" ? "menu-item menu-item-danger" : "menu-item";
