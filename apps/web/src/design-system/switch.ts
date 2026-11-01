/**
 * The Switch: one setting that is on or off, and takes effect when it is flipped. The one place its
 * class is written. Switch.astro renders from it; a script or a React island that draws a switch
 * calls switchClass(); the style guide lists SWITCH. The rules are in styles/switch.css.
 */
import type { Guidance } from "./guidance";

export const SWITCH: Guidance = {
  summary: "A track and a thumb for one setting that is on or off, with its label beside it.",
  useWhen: [
    "A setting is on or off and applies as soon as it is flipped: Sounds, Autoplay, a podcast's Enabled.",
    "It sits at the end of a settings row, with the row's label as its name.",
    "One switch stands for a group of switches (a master): the script sets `indeterminate` on it, and unchecks it, while only some of the group are on. The track sits halfway between the off grey and the accent and the thumb halfway along it. Pressing it turns the whole group on, or off when all are on.",
  ],
  dontUseWhen: [
    {
      when: "The choice is one of several values, or needs a Save to apply.",
      instead: "Chip",
    },
    {
      when: "The control starts an action (Catch up, Delete) and has no state of its own.",
      instead: "Button",
    },
    {
      when: "Several options may be ticked together in a list.",
      instead: "Chip",
    },
  ],
};

/** Every class the Switch draws, for the registry and its test. */
export const SWITCH_CLASSES: string[] = ["switch-input"];

/** Classes the Switch replaced; none may be written again, in any app that draws the system. */
export const SWITCH_RETIRED: string[] = ["settings-switch"];

/** The class that draws a switch. */
export const switchClass = (): string => "switch-input";
