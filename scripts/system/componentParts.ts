/**
 * The parts of the system that are real components (apps/web/src/design-system). Their facts come
 * from the registry, so the lookup file and the style guide cannot disagree; this file adds only the
 * words a lookup matches against and the one-line rules the registry does not hold. A family that
 * becomes a component adds its entry here and deletes its hand-written ones from parts.ts.
 */
import { BADGE } from "../../apps/web/src/design-system/badge.js";
import { BANNER } from "../../apps/web/src/design-system/banner.js";
import { BUTTON } from "../../apps/web/src/design-system/button.js";
import { DIALOG } from "../../apps/web/src/design-system/dialog.js";
import { DRAWER } from "../../apps/web/src/design-system/drawer.js";
import { FIELD } from "../../apps/web/src/design-system/field.js";
import type { ComponentRef, Guidance } from "../../apps/web/src/design-system/guidance.js";
import { ICON } from "../../apps/web/src/design-system/icon.js";
import { MENU } from "../../apps/web/src/design-system/menu.js";
import { SELECT } from "../../apps/web/src/design-system/select.js";
import { SHEET } from "../../apps/web/src/design-system/sheet.js";
import { SLIDER } from "../../apps/web/src/design-system/slider.js";
import { SWITCH } from "../../apps/web/src/design-system/switch.js";
import type { PartSource } from "./types.js";

/** The part a `dontUseWhen` points at. A family not yet a component keeps its hand-written id. */
const PART_OF: Record<string, string> = {
  Icon: "icon",
  "Icon button": "icon-btn",
  Chip: "filter-chip",
  FAB: "fab",
  Link: "text-link",
  Switch: "switch",
  Slider: "slider",
  Field: "field",
  Select: "select",
  Menu: "menu",
  Badge: "badge",
  Banner: "banner",
  Dialog: "dialog",
  Sheet: "sheet",
  Drawer: "drawer",
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
      "In a dialog, Cancel and the filled button sit in a DialogActions row (EpisodeActions.astro); a form sheet keeps its one filled button in `.sheet-actions`.",
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

/** A single-class control (Switch, Slider): the registry's guidance plus the words a lookup matches. */
const control = (
  id: string,
  name: string,
  guidance: Guidance,
  extra: {
    keywords: string[];
    markup: string;
    rules?: string[];
    classes?: string[];
    files?: string[];
    /** Exclusions that point at a part not yet a component (a hand-written one in parts.ts). */
    not?: { when: string; use: string }[];
    kind?: PartSource["kind"];
  },
): PartSource => ({
  id,
  name,
  kind: extra.kind ?? "selection",
  summary: guidance.summary,
  classes: [`${id}-input`],
  files: extra.files ?? [`design-system/${name}.astro`, `design-system/${id}.ts`],
  when: sentences(guidance.useWhen),
  // An exclusion with no `instead` has no part to point at: the lookup leaves it out rather than guess.
  not: [
    ...guidance.dontUseWhen
      .filter((item) => item.instead)
      .map((item) => ({
        when: item.when.replace(/\.$/, ""),
        use: partOf(item.instead, "button-text"),
      })),
    ...(extra.not ?? []),
  ],
  keywords: extra.keywords,
  markup: extra.markup,
  rules: extra.rules,
  ...(extra.classes ? { classes: extra.classes } : {}),
});

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
  control("icon", "Icon", ICON, {
    kind: "display",
    classes: ["icon-glyph", "icon-glyph-lg"],
    not: [{ when: "the glyph must act when pressed", use: "icon-btn" }],
    markup: '<Icon name="plus" size="lg" />',
    keywords: ["icon", "glyph", "phosphor", "symbol", "chevron", "plus", "check"],
    rules: [
      "Draw it with <Icon>; a script builds one with iconHtml() and an island with <Icon> from player/ui, both through iconClass().",
      "A control that holds a glyph places it with its own rule; it never sets the glyph's size twice.",
    ],
  }),
  control("badge", "Badge", BADGE, {
    kind: "display",
    classes: ["badge-label"],
    not: [{ when: "the pill can be pressed or ticked", use: "filter-chip" }],
    markup: "<Badge>Admin</Badge>",
    keywords: ["badge", "tag", "pill", "count", "label"],
    rules: ["It holds one word or one number; the page places it with a class, never styles it."],
  }),
  control("switch", "Switch", SWITCH, {
    keywords: ["switch", "toggle", "on off", "boolean", "enable"],
    markup:
      '<div class="settings-row"><label class="settings-label" for="autoplay">Autoplay</label><Switch id="autoplay" name="autoplay" /></div>',
  }),
  control("slider", "Slider", SLIDER, {
    keywords: ["slider", "range", "volume", "speed", "scrub"],
    markup:
      '<Slider aria-label="Volume" min="0" max="1" step="0.05" value="0.7" style="--range-fill: 70%" />',
    rules: [
      "WebKit paints the filled track from --range-fill, which starts at 0%: set it to (value - min) / (max - min) as a percentage and update it on input.",
    ],
  }),
  control("field", "Field", FIELD, {
    keywords: ["field", "input", "text field", "textarea", "select", "dropdown", "form"],
    markup:
      '<div class="manage-field"><label for="title">Title</label><Field id="title" name="title" type="text" /></div>',
    rules: [
      "Draw it with <Field> (multiline for a textarea); a select or a script takes the class from fieldClass().",
      "A disabled field dims like a disabled switch; a disabled fieldset dims it the same way, on the same element.",
    ],
  }),
  control("select", "Select", SELECT, {
    not: [
      { when: "the value is one of two to four short options", use: "segmented-choice" },
      { when: "several values may be ticked together", use: "multiselect" },
    ],
    classes: ["select-outlined", "select-tonal"],
    files: [
      "design-system/Select.astro",
      "design-system/select.ts",
      "design-system/selectSheet.ts",
      "design-system/wheel.ts",
    ],
    keywords: [
      "select",
      "dropdown",
      "sort",
      "sort by",
      "order by",
      "picker",
      "choose one",
      "filter",
    ],
    markup:
      '<Select variant="tonal" label="Sort" data-library-sort><option value="newest">Newest first</option></Select>',
    rules: [
      'Outlined (the default) is a value in a form; tonal is a sort or a filter and takes data-active on its wrapper (find it with closest("[data-select]")) once its value is not the default.',
      'A select inside a settings row takes class="value-select" from settings.css, which draws it as the row\'s value.',
      "data-wheel on a short ordered run (the hours of a day) opens its phone sheet as a Wheel (design-system/wheel.ts), not as rows.",
    ],
  }),
  control("menu", "Menu", MENU, {
    classes: ["menu-list", "menu-sheet", "menu-item", "menu-item-danger"],
    keywords: [
      "popover",
      "dots menu",
      "context menu",
      "action sheet",
      "more menu",
      "overflow menu",
    ],
    markup:
      '<Menu id="row-menu-3" title="Daily"><MenuItem><Icon name="pencilSimple" />Edit</MenuItem><MenuItem tone="danger"><Icon name="trash" />Delete</MenuItem></Menu>',
    rules: [
      "Under 40rem a menu is a sheet, never a small popover.",
      "A script finds one with MENU_SELECTORS (design-system/menu.ts); a string builder or an island takes menuListClass() and menuItemClass().",
    ],
  }),
  control("banner", "Banner", BANNER, {
    kind: "feedback",
    classes: ["banner-notice", "banner-text", "banner-title", "banner-body"],
    keywords: ["alert", "notice", "warning", "error message", "persistent"],
    not: [
      { when: "a message that clears itself", use: "toast" },
      { when: "a page with nothing to list", use: "empty-state" },
    ],
    markup: '<Banner tone="danger" icon="alert" title="Download failed" />',
    rules: [
      "Only the icon takes the tone.",
      "An island draws one with bannerClass() and bannerText.",
    ],
  }),
  control("dialog", "Dialog", DIALOG, {
    kind: "container",
    classes: ["dialog-panel", "dialog-body", "dialog-actions", "dialog-actions-stacked"],
    not: [{ when: "a form that slides in, with fields", use: "sheet" }],
    files: [
      "design-system/Dialog.astro",
      "design-system/DialogActions.astro",
      "design-system/DialogTitle.astro",
      "design-system/dialog.ts",
    ],
    keywords: ["confirm", "modal", "yes or no", "are you sure", "delete confirm"],
    markup:
      '<Dialog aria-labelledby="t"><DialogTitle id="t">Delete?</DialogTitle><DialogActions><Button variant="text">Cancel</Button></DialogActions></Dialog>',
    rules: [
      "A script finds one with DIALOG_SELECTOR; one it builds uses dialogClass(), dialogBodyClass() and dialogActionsClass().",
      "It renders closed: the script opens it with dialog.showModal() and closes it with dialog.close() from the Cancel button's click.",
    ],
  }),
  control("sheet", "Sheet", SHEET, {
    kind: "container",
    classes: ["sheet-side", "sheet-head", "sheet-body", "sheet-title"],
    files: [
      "design-system/Sheet.astro",
      "design-system/sheet.ts",
      "components/SheetHeader.astro",
      "lib/sheetHead.ts",
    ],
    keywords: [
      "bottom sheet",
      "title and close control",
      "panel",
      "side panel",
      "form sheet",
      "full screen sheet",
      "slide over",
      "modal form",
    ],
    markup:
      '<Sheet title="Regenerate" titleId="regen-title" close="data-dialog-close"><form>...</form></Sheet>',
    rules: [
      'A script finds one with SHEET_SELECTOR (design-system/sheet.ts); kind="create" is the New episode sheet, every other is a "panel".',
      "A header a script builds is sheetHeadHtml() (lib/sheetHead.ts); never write the row or its Close by hand.",
      "`sheet-field*`, `sheet-form` and `sheet-actions` are form layout in sheets.css, not the shell.",
    ],
  }),
  control("drawer", "Drawer", DRAWER, {
    kind: "container",
    classes: ["drawer-scrim", "drawer-viewport", "drawer-popup", "drawer-panel", "drawer-head"],
    files: ["sheets/SheetFrame.tsx", "design-system/drawer.ts"],
    keywords: ["island sheet", "swipe to dismiss", "Base UI drawer", "react sheet"],
    markup:
      '<SheetFrame open={open} onOpenChange={setOpen} title="Create" closeLabel="Close">...</SheetFrame>',
    rules: [
      "Mount SheetFrame; it draws the scrim, viewport, popup, panel and head from drawer.ts.",
      "Motion uses --duration-sheet-in, --duration-sheet-out and --ease-drawer.",
    ],
  }),
];
