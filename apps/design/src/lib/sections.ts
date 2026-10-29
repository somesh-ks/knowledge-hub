import type { IconName } from "../../../web/src/lib/icons";

/** The style guide's pages, in nav order. */
export interface Section {
  /** The path under the base: "" for the component index. */
  path: string;
  label: string;
  icon: IconName;
  /** The page's one line under its title. */
  note: string;
}

export const SECTIONS: readonly Section[] = [
  {
    path: "",
    label: "Components",
    icon: "viewGrid",
    note: "Every shared part of the app, from the smallest to the largest, with its states to try.",
  },
  {
    path: "/colour",
    label: "Colour",
    icon: "star",
    note: "The semantic roles, the only colour layer a component may read, in the current theme.",
  },
  {
    path: "/type",
    label: "Type",
    icon: "viewList",
    note: "The text roles and the size scale, set live.",
  },
  {
    path: "/tokens",
    label: "Tokens",
    icon: "sliders",
    note: "Space, radius, shadow, motion, layers, layout and the icon set.",
  },
  {
    path: "/principles",
    label: "Principles",
    icon: "info",
    note: "What the app is trying to be, and the rules that keep it so.",
  },
];

/** An address under the base ("/design"), which Astro writes with or without a closing slash. */
export const href = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}` || "/";

/** The reader. On the shared domain it is "/"; the dev server of this app is another port, so it asks the reader's (4321). */
export const READER_HREF: string = import.meta.env.DEV ? "http://localhost:4321/" : "/";
