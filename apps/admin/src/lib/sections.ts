import type { IconName } from "../../../web/src/lib/icons";

/** The command center's sections, in nav order. `hint` is the line under the name on the overview. */
export interface Section {
  /** The path under the base: "" for the overview. */
  path: string;
  label: string;
  icon: IconName;
  /** The filled twin the nav shows for the current section, as the reader's does. */
  iconCurrent: IconName;
  /** What the section answers. */
  question: string;
  /** What the page holds today. */
  status: string;
}

export const SECTIONS: readonly Section[] = [
  {
    path: "",
    label: "Overview",
    icon: "gauge",
    iconCurrent: "gaugeFill",
    question: "At a glance.",
    status: "",
  },
  {
    path: "/coverage",
    label: "Coverage",
    icon: "chartDonut",
    iconCurrent: "chartDonutFill",
    question: "Design-system use.",
    status: "Planned",
  },
  {
    path: "/costs",
    label: "Costs",
    icon: "coins",
    iconCurrent: "coinsFill",
    question: "Paid services.",
    status: "Moves here next",
  },
  {
    path: "/health",
    label: "Health",
    icon: "heartbeat",
    iconCurrent: "heartbeatFill",
    question: "Runs, pages, services.",
    status: "Moves here next",
  },
];

/** An address under the base ("/admin"), which Astro writes with or without a closing slash. */
export const href = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}` || "/";

/** The reader. On the shared domain it is "/"; the dev server of this app is another port, so it asks the reader's (4321). */
export const READER_HREF: string = import.meta.env.DEV ? "http://localhost:4321/" : "/";
