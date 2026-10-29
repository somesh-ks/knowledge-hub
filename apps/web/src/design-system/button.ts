/**
 * The Button: its variants, its tone, their classes and when to use each. The one place a button's
 * class is written. Button.astro renders from it; a script or a React island that draws a button
 * calls buttonClass(); the style guide lists BUTTON. The rules are in styles/buttons.css.
 */
import type { Guidance } from "./guidance";

export type ButtonVariant = "filled" | "tonal" | "text";
export type ButtonTone = "danger";

export const BUTTON: Guidance & {
  variants: Record<ButtonVariant, Guidance & { label: string }>;
  tones: Record<ButtonTone, Guidance & { label: string; variant: ButtonVariant }>;
} = {
  summary: "A labelled action: words on a 44px target that does something or goes somewhere.",
  useWhen: [
    "The action has a word label: Save, Cancel, Add source, Try again, See all.",
    "It submits a form, opens or closes a dialog, or goes to a page (give it an href).",
  ],
  dontUseWhen: [
    "The control is a single glyph with no words: use an Icon button.",
    "The control picks one of several options or switches a state: use a Chip, Switch or Segmented control.",
    "The control floats over the page (Catch up, Play on a story): use a FAB.",
    "The words are part of a sentence and open another page: use a Link.",
  ],
  variants: {
    filled: {
      label: "Filled",
      summary: "The accent fill under its own words; the most prominent button.",
      useWhen: [
        "It is the one action that commits a sheet, a dialog or an empty page: Save, Add category, Listen now.",
      ],
      dontUseWhen: [
        "Another filled button is on the same surface: make the second one Tonal.",
        "The action dismisses or backs out (Cancel, Hide this): use Text.",
        "Many rows repeat it: use a Text button or an Icon button in each row.",
      ],
    },
    tonal: {
      label: "Tonal",
      summary: "The accent container under its own words, with no outline; quieter than Filled.",
      useWhen: [
        "It is the alternative beside a Filled button.",
        "It is a labelled add or reorder action on a list: Add source, Add section, Reorder.",
      ],
      dontUseWhen: [
        "It is the only action that commits the surface: use Filled.",
        "It dismisses or backs out: use Text.",
      ],
    },
    text: {
      label: "Text",
      summary:
        "An accent label with no container until it is hovered or pressed; the quietest button.",
      useWhen: [
        "It dismisses, backs out or repeats: Cancel, Clear, Try again, Hide this.",
        "It sits beside a Filled button as the lesser choice.",
        "It is a short action on a card or a banner: See all, Install.",
      ],
      dontUseWhen: [
        "The action must be found at a glance on its own: use Filled.",
        "It has a glyph and no words: use an Icon button.",
      ],
    },
  },
  tones: {
    danger: {
      label: "Danger",
      variant: "text",
      summary: "A Text button in the danger colour.",
      useWhen: [
        "It is the confirm of a delete, in a dialog that asks first: Delete, Delete source.",
      ],
      dontUseWhen: [
        "The action is not destructive, or nobody has been asked to confirm: use a plain Text button.",
        "It is the first control on a surface: red is for the second step, after the person has asked to delete.",
      ],
    },
  },
};

/** Every class the Button draws, for the registry and its test. */
export const BUTTON_CLASSES: string[] = [
  ...Object.keys(BUTTON.variants).map((variant) => `button-${variant}`),
  ...Object.keys(BUTTON.tones).map((tone) => `button-${tone}`),
];

/** The classes that draw a button of this variant (and tone). */
export const buttonClass = (variant: ButtonVariant, tone?: ButtonTone): string =>
  tone ? `button-${variant} button-${tone}` : `button-${variant}`;
