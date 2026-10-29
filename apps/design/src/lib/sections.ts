import type { IconName } from "../../../web/src/lib/icons";

/** One page of the guide. */
export interface Section {
  /** The path under the base: "" for the overview. */
  path: string;
  label: string;
  /** The page's own icon, and the filled one the current page shows. */
  icon: IconName;
  iconCurrent: IconName;
  /** The page's one line under its title. */
  note: string;
}

export const OVERVIEW: Section = {
  path: "",
  label: "Overview",
  icon: "house",
  iconCurrent: "houseFill",
  note: "How the app looks and moves, drawn from the app itself.",
};

export const PRINCIPLES: Section = {
  path: "/principles",
  label: "Principles",
  icon: "compass",
  iconCurrent: "compassFill",
  note: "What the app is trying to be, and the rules that keep it so.",
};

export const FOUNDATIONS: Section = {
  path: "/foundations",
  label: "Foundations",
  icon: "stack",
  iconCurrent: "stack",
  note: "What every component is built from.",
};

/** The pages under Foundations, in order. */
export const FOUNDATION_PAGES: readonly Section[] = [
  {
    path: "/colour",
    label: "Colour",
    icon: "palette",
    iconCurrent: "paletteFill",
    note: "Roles, not colours: a component reads a role, and the role follows the theme.",
  },
  {
    path: "/type",
    label: "Typography",
    icon: "textAa",
    iconCurrent: "textAaFill",
    note: "The text roles and the size scale, set live.",
  },
  {
    path: "/motion",
    label: "Motion",
    icon: "waveSine",
    iconCurrent: "waveSineFill",
    note: "How things move: durations, easing and springs, run live.",
  },
  {
    path: "/tokens",
    label: "Tokens",
    icon: "sliders",
    iconCurrent: "slidersFill",
    note: "Space, radius, shadow, motion, layers, layout and the icon set.",
  },
];

export const COMPONENTS: Section = {
  path: "/components",
  label: "Components",
  icon: "shapes",
  iconCurrent: "shapesFill",
  note: "The parts the app itself imports, and when to use each.",
};

/** Every page, for a page to find its own title and line by path. */
export const SECTIONS: readonly Section[] = [
  OVERVIEW,
  PRINCIPLES,
  FOUNDATIONS,
  ...FOUNDATION_PAGES,
  COMPONENTS,
];

/** The navigation: top-level pages, and the one group that has pages under it. */
export const NAV: readonly { page: Section; children?: readonly Section[] }[] = [
  { page: OVERVIEW },
  { page: PRINCIPLES },
  { page: FOUNDATIONS, children: FOUNDATION_PAGES },
  { page: COMPONENTS },
];

/** An address under the base ("/design"), which Astro writes with or without a closing slash. */
export const href = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}` || "/";
