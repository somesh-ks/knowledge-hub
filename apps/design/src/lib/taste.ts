import type { IconName } from "../../../web/src/lib/icons";

/**
 * The owner's taste as reusable rules, mined from the design-engineering ledger, the decisions and
 * his own messages. The words behind each rule live in those records, named by D-number. A rule
 * changes only when he says so.
 */

export interface TasteValue {
  title: string;
  icon: IconName;
  /** The rule, in a sentence or two of plain words. */
  rule: string;
  /** The decisions behind it, when there are any. */
  refs?: string;
}

export interface TasteGroup {
  /** Also the filter value in the toolbar. */
  id: string;
  label: string;
  /** One line under the heading, when the cards need framing. */
  note?: string;
  values: readonly TasteValue[];
}

export const TASTE_GROUPS: readonly TasteGroup[] = [
  {
    id: "look",
    label: "How it looks",
    values: [
      {
        title: "Nothing looks generated",
        icon: "alert",
        rule: "Boxes around everything, uppercase tags and homemade controls make a page look machine-made. Remove them.",
        refs: "D72, D76",
      },
      {
        title: "Blue means current",
        icon: "palette",
        rule: "Blue marks what is chosen or current. Everything at rest is grey.",
        refs: "D86, D203",
      },
      {
        title: "Medium colour",
        icon: "moon",
        rule: "Keep colours medium. If something looks faded on a phone, bring it up one step.",
        refs: "D121, D171",
      },
      {
        title: "Hierarchy by size",
        icon: "textAa",
        rule: "Size and space set the hierarchy. Headings are regular weight and nothing is bold.",
        refs: "D125, D131",
      },
      {
        title: "Align by eye",
        icon: "viewList",
        rule: "Line things up by what looks even, not by what measures even.",
        refs: "D167, D187",
      },
      {
        title: "Only the cover decorates",
        icon: "starOutline",
        rule: "The cover art's own colour and light are the only decoration.",
        refs: "D48, D122, D123",
      },
    ],
  },
  {
    id: "controls",
    label: "How controls work",
    values: [
      {
        title: "No instructions",
        icon: "shapes",
        rule: "A control shows what it does through its icon and shape. If it needs a sentence, change the control.",
        refs: "D52, D92",
      },
      {
        title: "Same everywhere",
        icon: "viewGrid",
        rule: "A component looks the same on every page, at every width and in every app.",
        refs: "D133, D167, D186",
      },
      {
        title: "Familiar controls",
        icon: "check",
        rule: "Use the plainest control people already know, and the simplest outline icon.",
        refs: "D31, D133, D191",
      },
    ],
  },
  {
    id: "behaviour",
    label: "How it behaves",
    values: [
      {
        title: "Hold still",
        icon: "pin",
        rule: "Nothing changes size, shifts or scrolls unless the reader moved it.",
        refs: "D94, D95, D133",
      },
      {
        title: "Say only what helps",
        icon: "info",
        rule: "Speak when the reader can act on it. A control confirms its own save.",
        refs: "D84, D115",
      },
      {
        title: "Instant response",
        icon: "lightning",
        rule: "A wait the reader can feel is a bug. Show the result first and confirm after.",
        refs: "D47, D82, D142",
      },
      {
        title: "Gentle delight",
        icon: "waveform",
        rule: "Add delight in small doses where it rewards an action, such as a press sound. Start gentle.",
        refs: "D123, D230",
      },
      {
        title: "Built for one thumb",
        icon: "arrowDown",
        rule: "Lists open as bottom sheets, swipes dismiss, and the main action sits low.",
        refs: "D52, D133, D167",
      },
    ],
  },
  {
    id: "working",
    label: "How we work",
    values: [
      {
        title: "Copy a real app",
        icon: "compass",
        rule: "Check how Google Podcasts or YouTube Music does it, then do that.",
        refs: "D31, D72",
      },
      {
        title: "Ask before cutting",
        icon: "trash",
        rule: "Remove extra furniture freely. Ask before removing anything he asked for.",
        refs: "D89, D100, D114",
      },
      {
        title: "Keep changes small",
        icon: "sliders",
        rule: "A feature reuses the page it lands on. Shared components change in their own PR.",
        refs: "",
      },
      {
        title: "Show before building",
        icon: "create",
        rule: "Show a picture or recording first, and expect several rounds of tuning.",
        refs: "D121",
      },
    ],
  },
  {
    id: "differs",
    label: "Differs from Material 3",
    values: [
      {
        title: "Filled buttons",
        icon: "shapes",
        rule: "Material outlines buttons and cards. We keep outlines for text fields.",
      },
      {
        title: "One round shape",
        icon: "viewGrid",
        rule: "Material gives each control its own corner. Ours are all fully round.",
      },
      {
        title: "Regular titles",
        icon: "textAa",
        rule: "Material uses medium weight. We use regular everywhere.",
      },
      {
        title: "Phosphor icons",
        icon: "starOutline",
        rule: "Material has its own symbols. We use Phosphor outline.",
      },
      {
        title: "No drag handle",
        icon: "grip",
        rule: "Material puts a handle on sheets. We leave it off.",
      },
      { title: "44px targets", icon: "sliders", rule: "Material asks for 48. We use 44." },
      {
        title: "One fixed accent",
        icon: "palette",
        rule: "Material takes colour from content. Ours only lights the cover background.",
      },
      {
        title: "Snackbars that ask",
        icon: "info",
        rule: "A snackbar shows only when it carries an action.",
      },
    ],
  },
  {
    id: "expressive",
    label: "Material 3 Expressive",
    note: "Not decided yet. These are the likely answers.",
    values: [
      {
        title: "Play button reshapes",
        icon: "play",
        rule: "Only the big Play button, inside its own box.",
      },
      {
        title: "Wave while playing",
        icon: "waveSine",
        rule: "Wavy progress only while audio plays. Flat when paused.",
      },
      {
        title: "Gentle overshoot",
        icon: "heartbeat",
        rule: "The bouncier spring only under a finger.",
      },
      {
        title: "Loader that changes shape",
        icon: "refresh",
        rule: "Only while a run he started is going.",
      },
      {
        title: "Bolder colour",
        icon: "palette",
        rule: "Only the main action and the cover. Cards stay grey.",
      },
      { title: "No button groups", icon: "viewList", rule: "A press moves one button only." },
      { title: "No emphasized type", icon: "textAa", rule: "Size and space carry emphasis." },
      { title: "No decoration", icon: "shapes", rule: "A shape only when it shows state." },
    ],
  },
];
