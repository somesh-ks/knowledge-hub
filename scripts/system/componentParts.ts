/**
 * The parts of the system that are real components (apps/web/src/design-system). Their facts come
 * from the registry, so the lookup file and the style guide cannot disagree; this file adds only the
 * words a lookup matches against and the one-line rules the registry does not hold. A family that
 * becomes a component adds its entry here and deletes its hand-written ones from parts.ts.
 */
import { BUTTON } from "../../apps/web/src/design-system/button.js";
import type { ComponentRef } from "../../apps/web/src/design-system/guidance.js";
import type { PartSource } from "./types.js";

/** The part a `dontUseWhen` points at. A family not yet a component keeps its hand-written id. */
const PART_OF: Record<string, string> = {
  "Icon button": "icon-btn",
  Chip: "filter-chip",
  FAB: "fab",
  Link: "text-link",
};

const partOf = (ref: ComponentRef | undefined, fallback: string): string => {
  if (!ref) return fallback;
  const [component, part] = ref.split(".");
  if (component === "Button" && part) return `button-${part}`;
  return PART_OF[component ?? ""] ?? fallback;
};

const words: Record<string, { keywords: string[]; markup: string; rules?: string[] }> = {
  filled: {
    keywords: ["save", "submit", "cta", "main button", "filled", "primary"],
    markup: '<Button variant="filled" type="submit">Save</Button>',
    rules: ["At most one per surface.", "Never a bold label."],
  },
  tonal: {
    keywords: ["secondary", "companion", "second action", "beside the primary", "tonal"],
    markup: '<Button variant="tonal">Share</Button>',
    rules: ["Matches the filled button's height.", "No outline."],
  },
  text: {
    keywords: ["cancel", "text action", "tertiary", "dismiss", "quiet button"],
    markup: '<Button variant="text">Cancel</Button>',
    rules: [
      "In a dialog, Cancel and the filled button sit in a `.confirm-actions` row (EpisodeActions.astro); a form sheet keeps its one filled button in `.sheet-actions`.",
    ],
  },
  danger: {
    keywords: ["delete", "destructive", "remove", "red"],
    markup: '<Button variant="text" tone="danger">Delete</Button>',
  },
};

/** The lookup file ends each situation itself, so the registry's full stops come off. */
const sentences = (lines: readonly string[]): string[] =>
  lines.map((line) => line.replace(/\.$/, ""));

const FILES = ["design-system/Button.astro", "design-system/button.ts"];

export const componentParts = (): PartSource[] => [
  ...Object.entries(BUTTON.variants).map(([variant, guidance]): PartSource => {
    const id = `button-${variant}`;
    const extra = words[variant];
    return {
      id,
      name: `${guidance.label} button`,
      kind: "action",
      summary: guidance.summary,
      classes: [id],
      files: FILES,
      when: sentences(guidance.useWhen),
      not: [
        ...guidance.dontUseWhen.map((item) => ({
          when: item.when.replace(/\.$/, ""),
          use: partOf(item.instead, id),
        })),
        ...(variant === "filled"
          ? [{ when: "an action that only creates, in the side column", use: "btn-action-tonal" }]
          : []),
      ],
      keywords: extra?.keywords,
      markup: extra?.markup,
      rules: extra?.rules,
    };
  }),
  ...Object.entries(BUTTON.tones).map(([tone, guidance]): PartSource => {
    const id = `button-${tone}`;
    const extra = words[tone];
    return {
      id,
      name: `${guidance.label} button`,
      kind: "action",
      summary: guidance.summary,
      classes: [id],
      files: FILES,
      when: sentences(guidance.useWhen),
      not: guidance.dontUseWhen.map((item) => ({
        when: item.when.replace(/\.$/, ""),
        use: partOf(item.instead, `button-${guidance.variant}`),
      })),
      keywords: extra?.keywords,
      markup: extra?.markup,
    };
  }),
];
