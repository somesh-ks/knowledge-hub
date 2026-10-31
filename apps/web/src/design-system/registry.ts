/**
 * The design system's components: each one's name, the stylesheet that draws it, the prefix its
 * classes share, the classes it draws and when to use it. The style guide lists these, and
 * designSystem.test.ts holds the app to them. A new component is added here in the PR that adds it;
 * a class not listed here is not part of the system.
 */
import { BADGE, BADGE_CLASSES, BADGE_RETIRED } from "./badge";
import { BANNER, BANNER_CLASSES, BANNER_RETIRED } from "./banner";
import { BUTTON, BUTTON_CLASSES, BUTTON_RETIRED } from "./button";
import { DIALOG, DIALOG_CLASSES, DIALOG_RETIRED } from "./dialog";
import { DRAWER, DRAWER_CLASSES, DRAWER_RETIRED } from "./drawer";
import { FIELD, FIELD_CLASSES, FIELD_RETIRED } from "./field";
import type { Guidance } from "./guidance";
import { ICON, ICON_CLASSES, ICON_RETIRED } from "./icon";
import { MENU, MENU_CLASSES, MENU_RETIRED } from "./menu";
import { SELECT, SELECT_CLASSES, SELECT_RETIRED } from "./select";
import { SHEET, SHEET_CLASSES, SHEET_RETIRED } from "./sheet";
import { SLIDER, SLIDER_CLASSES, SLIDER_RETIRED } from "./slider";
import { SWITCH, SWITCH_CLASSES, SWITCH_RETIRED } from "./switch";
import { WHEEL, WHEEL_CLASSES, WHEEL_RETIRED } from "./wheel";

export interface DesignSystemComponent extends Guidance {
  name: string;
  /** The stylesheet in styles/ that holds its rules. */
  sheet: string;
  /** Every class the component draws starts with this. */
  prefix: string;
  classes: string[];
  /** Classes it replaced, which no app may write again. */
  retired: string[];
  /** Its variants and tones, each with its own guidance. */
  parts: Record<string, Guidance>;
}

export const COMPONENTS: DesignSystemComponent[] = [
  {
    name: "Button",
    sheet: "buttons.css",
    prefix: "button-",
    classes: BUTTON_CLASSES,
    retired: BUTTON_RETIRED,
    summary: BUTTON.summary,
    useWhen: BUTTON.useWhen,
    dontUseWhen: BUTTON.dontUseWhen,
    parts: { ...BUTTON.variants, ...BUTTON.tones },
  },
  {
    name: "Icon",
    sheet: "icon.css",
    prefix: "icon-glyph",
    classes: ICON_CLASSES,
    retired: ICON_RETIRED,
    summary: ICON.summary,
    useWhen: ICON.useWhen,
    dontUseWhen: ICON.dontUseWhen,
    parts: ICON.sizes,
  },
  {
    name: "Badge",
    sheet: "badge.css",
    prefix: "badge-",
    classes: BADGE_CLASSES,
    retired: BADGE_RETIRED,
    summary: BADGE.summary,
    useWhen: BADGE.useWhen,
    dontUseWhen: BADGE.dontUseWhen,
    parts: {},
  },
  {
    name: "Switch",
    sheet: "switch.css",
    prefix: "switch-",
    classes: SWITCH_CLASSES,
    retired: SWITCH_RETIRED,
    summary: SWITCH.summary,
    useWhen: SWITCH.useWhen,
    dontUseWhen: SWITCH.dontUseWhen,
    parts: {},
  },
  {
    name: "Slider",
    sheet: "slider.css",
    prefix: "slider-",
    classes: SLIDER_CLASSES,
    retired: SLIDER_RETIRED,
    summary: SLIDER.summary,
    useWhen: SLIDER.useWhen,
    dontUseWhen: SLIDER.dontUseWhen,
    parts: {},
  },
  {
    name: "Field",
    sheet: "field.css",
    prefix: "field-",
    classes: FIELD_CLASSES,
    retired: FIELD_RETIRED,
    summary: FIELD.summary,
    useWhen: FIELD.useWhen,
    dontUseWhen: FIELD.dontUseWhen,
    parts: {},
  },
  {
    name: "Select",
    sheet: "select.css",
    prefix: "select-",
    classes: SELECT_CLASSES,
    retired: SELECT_RETIRED,
    summary: SELECT.summary,
    useWhen: SELECT.useWhen,
    dontUseWhen: SELECT.dontUseWhen,
    parts: SELECT.variants,
  },
  {
    name: "Menu",
    sheet: "menu.css",
    prefix: "menu-",
    classes: MENU_CLASSES,
    retired: MENU_RETIRED,
    summary: MENU.summary,
    useWhen: MENU.useWhen,
    dontUseWhen: MENU.dontUseWhen,
    parts: MENU.tones,
  },
  {
    name: "Banner",
    sheet: "banner.css",
    prefix: "banner-",
    classes: BANNER_CLASSES,
    retired: BANNER_RETIRED,
    summary: BANNER.summary,
    useWhen: BANNER.useWhen,
    dontUseWhen: BANNER.dontUseWhen,
    parts: BANNER.tones,
  },
  {
    name: "Dialog",
    sheet: "dialog.css",
    prefix: "dialog-",
    classes: DIALOG_CLASSES,
    retired: DIALOG_RETIRED,
    summary: DIALOG.summary,
    useWhen: DIALOG.useWhen,
    dontUseWhen: DIALOG.dontUseWhen,
    parts: {},
  },
  {
    name: "Sheet",
    sheet: "sheet.css",
    prefix: "sheet-",
    classes: SHEET_CLASSES,
    retired: SHEET_RETIRED,
    summary: SHEET.summary,
    useWhen: SHEET.useWhen,
    dontUseWhen: SHEET.dontUseWhen,
    parts: {},
  },
  {
    name: "Drawer",
    sheet: "drawer.css",
    prefix: "drawer-",
    classes: DRAWER_CLASSES,
    retired: DRAWER_RETIRED,
    summary: DRAWER.summary,
    useWhen: DRAWER.useWhen,
    dontUseWhen: DRAWER.dontUseWhen,
    parts: {},
  },
  {
    name: "Wheel",
    sheet: "wheel.css",
    prefix: "wheel-",
    classes: WHEEL_CLASSES,
    retired: WHEEL_RETIRED,
    summary: WHEEL.summary,
    useWhen: WHEEL.useWhen,
    dontUseWhen: WHEEL.dontUseWhen,
    parts: {},
  },
];
