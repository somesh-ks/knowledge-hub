/**
 * The Select: a native select that draws its own chevron and opens a list the page styles, in two
 * variants. The one place its classes are written. Select.astro renders from it; a script or a React
 * island that draws one calls selectClass(); the style guide lists SELECT. The rules are in
 * styles/select.css. The wrapper carries `data-select`, so a script finds it with
 * `closest("[data-select]")`, and `data-active` on a tonal one says its value is not the default.
 */
import type { Guidance } from "./guidance";

export type SelectVariant = "outlined" | "tonal";

export const SELECT: Guidance & {
  variants: Record<SelectVariant, Guidance & { label: string }>;
} = {
  summary:
    "A native select with its own chevron: a person picks one value from a list that is too long to show.",
  useWhen: [
    "A person picks one value from a list of five or more, or of names that are too long for a row of chips.",
    "It sits under its own label in a form, or in a toolbar as a sort or a filter.",
  ],
  dontUseWhen: [
    {
      when: "The value is one of two to four short options.",
      instead: "Chip",
    },
    {
      when: "The list is long enough to need a search box (a time zone, a voice).",
    },
    {
      when: "Several values may be ticked together.",
    },
  ],
  variants: {
    outlined: {
      label: "Outlined",
      summary: "A pill with a hairline outline on the page's own surface, as a Field is.",
      useWhen: [
        "It is a value a person sets in a form: a category, a type, a voice, a model.",
        "It sits beside a Field and should read as part of the same form.",
      ],
      dontUseWhen: [
        {
          when: "It sorts or filters what is on the page.",
          instead: "Select.tonal",
        },
      ],
    },
    tonal: {
      label: "Tonal",
      summary:
        "A chip on the container tone with no outline; it takes the accent container once its value is not the default.",
      useWhen: [
        "It sorts or filters a list or a chart: the Library's order, the Costs range, a day's Catch ups.",
        "It sits in a toolbar beside chips and a search field.",
      ],
      dontUseWhen: [
        {
          when: "It is a value a person sets in a form.",
          instead: "Select.outlined",
        },
      ],
    },
  },
};

/** Every class the Select draws, for the registry and its test. */
export const SELECT_CLASSES: string[] = ["select-outlined", "select-tonal"];

/** Classes the Select replaced; none may be written again, in any app that draws the system. */
export const SELECT_RETIRED: string[] = ["manage-select", "sort-field", "create-select"];

/** The class that draws a select's wrapper, for a script or an island. */
export const selectClass = (variant: SelectVariant = "outlined"): string => `select-${variant}`;
