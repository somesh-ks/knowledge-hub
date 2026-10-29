/** The command center's sections, in nav order. `status` says what the page holds today. */
export interface Section {
  href: string;
  label: string;
  /** One line under the name: what the section answers. */
  question: string;
  status: "next" | "planned";
}

export const SECTIONS: readonly Section[] = [
  {
    href: "/design",
    label: "Design system",
    question: "Colours, type, tokens and every component, live.",
    status: "next",
  },
  {
    href: "/coverage",
    label: "Coverage",
    question: "How much of the app uses the shared parts.",
    status: "planned",
  },
  {
    href: "/costs",
    label: "Costs",
    question: "What the paid services cost.",
    status: "next",
  },
  {
    href: "/health",
    label: "Health",
    question: "How the runs, pages and services are doing.",
    status: "next",
  },
];

export const STATUS_LABEL: Record<Section["status"], string> = {
  next: "Moves here next",
  planned: "Planned",
};
