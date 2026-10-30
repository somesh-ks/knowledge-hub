/**
 * The design system's components: each one's name, the stylesheet that draws it, the prefix its
 * classes share, the classes it draws and when to use it. The style guide lists these, and
 * designSystem.test.ts holds the app to them. A new component is added here in the PR that adds it;
 * a class not listed here is not part of the system.
 */
import { BUTTON, BUTTON_CLASSES, BUTTON_RETIRED } from "./button";
import type { Guidance } from "./guidance";
import { SLIDER, SLIDER_CLASSES, SLIDER_RETIRED } from "./slider";
import { SWITCH, SWITCH_CLASSES, SWITCH_RETIRED } from "./switch";

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
];
