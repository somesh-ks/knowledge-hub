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
  note: "What the app is for.",
};

/** The pages under Principles. */
export const PRINCIPLES_PAGES: readonly Section[] = [
  {
    path: "/taste",
    label: "Taste",
    icon: "starOutline",
    iconCurrent: "starOutline",
    note: "What the owner likes, as values beside Material 3's, with the words behind each.",
  },
];

export const FOUNDATIONS: Section = {
  path: "/foundations",
  label: "Foundations",
  icon: "stack",
  iconCurrent: "stack",
  note: "What everything is built from.",
};

/** The pages under Foundations, in order. */
export const FOUNDATION_PAGES: readonly Section[] = [
  {
    path: "/color",
    label: "Color",
    icon: "palette",
    iconCurrent: "paletteFill",
    note: "Every role, in both themes.",
  },
  {
    path: "/type",
    label: "Typography",
    icon: "textAa",
    iconCurrent: "textAaFill",
    note: "Roles and sizes.",
  },
  {
    path: "/motion",
    label: "Motion",
    icon: "waveSine",
    iconCurrent: "waveSineFill",
    note: "Durations, curves and springs.",
  },
  {
    path: "/tokens",
    label: "Tokens",
    icon: "sliders",
    iconCurrent: "slidersFill",
    note: "Space, radius, shadow and icons.",
  },
];

export const COMPONENTS: Section = {
  path: "/components",
  label: "Components",
  icon: "shapes",
  iconCurrent: "shapesFill",
  note: "The parts the app imports.",
};

/** Every page, for a page to find its own title and line by path. */
export const SECTIONS: readonly Section[] = [
  OVERVIEW,
  PRINCIPLES,
  ...PRINCIPLES_PAGES,
  FOUNDATIONS,
  ...FOUNDATION_PAGES,
  COMPONENTS,
];

/** The navigation: top-level pages, and the one group that has pages under it. */
export const NAV: readonly { page: Section; children?: readonly Section[] }[] = [
  { page: OVERVIEW },
  { page: PRINCIPLES, children: PRINCIPLES_PAGES },
  { page: FOUNDATIONS, children: FOUNDATION_PAGES },
  { page: COMPONENTS },
];

/** An address under the base ("/design"), which Astro writes with or without a closing slash. */
export const href = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}` || "/";
