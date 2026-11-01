/**
 * The Icon: one Phosphor glyph, a single filled path that takes its colour from the text around it.
 * The one place its classes are written. Icon.astro renders from it; a script or a React island that
 * draws one calls iconClass(); the style guide lists ICON. The rules are in styles/icon.css.
 */
import type { Guidance } from "./guidance";

export type IconSize = "md" | "lg";

export const ICON: Guidance & { sizes: Record<IconSize, Guidance & { label: string }> } = {
  summary: "A filled Phosphor glyph in the colour of the text beside it.",
  useWhen: ["A mark beside a label or alone in a button: a chevron, a plus, a check, Play."],
  dontUseWhen: [
    {
      when: "The picture is an illustration, a logo or a cover.",
    },
    {
      when: "The glyph must act when pressed.",
      instead: "Icon button",
    },
  ],
  sizes: {
    md: {
      label: "Medium",
      summary: "24px: beside text, inside a row, a chip or a menu item.",
      useWhen: ["The glyph sits with words."],
      dontUseWhen: [{ when: "The glyph is the whole button.", instead: "Icon.lg" }],
    },
    lg: {
      label: "Large",
      summary: "The size of a lone glyph in a button, a bar or a tab.",
      useWhen: ["The glyph is the whole button: Close, More, a nav destination, Play."],
      dontUseWhen: [{ when: "The glyph sits beside a label.", instead: "Icon.md" }],
    },
  },
};

/** Every class the Icon draws, for the registry and its test. */
export const ICON_CLASSES: string[] = ["icon-glyph", "icon-glyph-lg"];

/** Classes the Icon replaced; none may be written again, in any app that draws the system. */
export const ICON_RETIRED: string[] = ["ui-icon", "icon-lg"];

/** The classes of a glyph, for a script or an island that builds its own svg. */
export const iconClass = (size: IconSize = "md"): string =>
  size === "lg" ? "icon-glyph icon-glyph-lg" : "icon-glyph";
