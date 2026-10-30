/**
 * The Field: a text input, a textarea or a select whose value a person types or picks, outlined on the
 * page's own surface. The one place its class is written. Field.astro renders from it; a script or a
 * React island that draws a field calls fieldClass(); the style guide lists FIELD. The rules are in
 * styles/field.css.
 */
import type { Guidance } from "./guidance";

export const FIELD: Guidance = {
  summary:
    "An outlined box for text or a pick: one line, several lines (multiline) or a native select.",
  useWhen: [
    "A person types a short value or a few lines: a title, a feed address, a prompt.",
    "A person picks one value from a list that is too long for a segmented choice, with a native select.",
    "It sits under its own label in a form or a settings row, and a refused value shows as an invalid field.",
  ],
  dontUseWhen: [
    {
      when: "The value is one of two to four short options.",
      instead: "Chip",
    },
    {
      when: "The setting is on or off and applies as soon as it is flipped.",
      instead: "Switch",
    },
    {
      when: "The value is a number on a scale.",
      instead: "Slider",
    },
  ],
};

/** Every class the Field draws, for the registry and its test. */
export const FIELD_CLASSES: string[] = ["field-input"];

/** Classes the Field replaced; none may be written again, in any app that draws the system. */
export const FIELD_RETIRED: string[] = ["manage-input", "sheet-input"];

/** The class that draws a field on an input, a textarea or a select. */
export const fieldClass = (): string => "field-input";
