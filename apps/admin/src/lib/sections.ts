import type { IconName } from "../../../web/src/lib/icons";

/** The command center's sections, in nav order. `hint` is the line under the name on the overview. */
export interface Section {
  /** The path under the base: "" for the overview. */
  path: string;
  label: string;
  icon: IconName;
  /** What the section answers. */
  question: string;
  /** What the page holds today. */
  status: string;
}

export const SECTIONS: readonly Section[] = [
  {
    path: "",
    label: "Overview",
    icon: "viewGrid",
    question: "Everything at a glance.",
    status: "",
  },
  {
    path: "/coverage",
    label: "Coverage",
    icon: "table",
    question: "How much of the app uses the shared design-system parts.",
    status: "Planned",
  },
  {
    path: "/costs",
    label: "Costs",
    icon: "chartBar",
    question: "What the paid services cost.",
    status: "Moves here next",
  },
  {
    path: "/health",
    label: "Health",
    icon: "waveform",
    question: "How the runs, pages and services are doing.",
    status: "Moves here next",
  },
];

/** An address under the base ("/admin"), which Astro writes with or without a closing slash. */
export const href = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}` || "/";
