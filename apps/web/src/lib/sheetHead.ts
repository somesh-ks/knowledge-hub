/**
 * The markup of a sheet's header row and of an icon, written once for the Astro components
 * (SheetHeader.astro, Icon.astro) and for the lists a script redraws (structureView.ts), so a menu
 * a script builds is the same menu a page builds (the design-system audit, 2026-10-25).
 */
import { type IconSize, iconClass } from "../design-system/icon";
import { menuItemClass } from "../design-system/menu";
import {
  sheetHeadClass,
  sheetHeadingClass,
  sheetSubtitleClass,
  sheetTitleClass,
} from "../design-system/sheet";
import { ICON_BOLD_PATHS, ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./icons";

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** One glyph, as Icon.astro draws it: `data-icon` names it for buttons.css's ink margins (D187). */
export const iconHtml = (name: IconName, size: IconSize = "md"): string => {
  const bold = ICON_BOLD_PATHS[name];
  const paths = bold
    ? `<path d="${ICON_PATHS[name]}" data-weight="regular"></path><path d="${bold}" data-weight="bold"></path>`
    : `<path d="${ICON_PATHS[name]}"></path>`;
  return `<svg class="${iconClass(size)}" data-icon="${name}" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false">${paths}</svg>`;
};

export type SheetClose =
  | "data-create-close"
  | "data-panel-close"
  | "data-dialog-close"
  | "data-menu-close";

/**
 * A sheet's one header row (2026-10-20): the title at the start, Close at the end, in every sheet at
 * every width, as SheetFrame.tsx lays out. pullDismiss.ts and keyboardFit.ts find the row by
 * SHEET_HEAD (design-system/sheet.ts). The title is escaped here; `titleData` holds data attributes for the title.
 */
export function sheetHeadHtml(
  title: string,
  titleId: string,
  close: SheetClose,
  titleData: Record<`data-${string}`, string | boolean> = {},
  subtitle?: string,
): string {
  const data = Object.entries(titleData)
    .filter(([, value]) => value !== false)
    .map(([name, value]) =>
      value === true || value === "" ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`,
    )
    .join("");
  const heading = `<h2 class="${sheetTitleClass()}" id="${titleId}"${data}>${escapeHtml(title)}</h2>`;
  return (
    `<div class="${sheetHeadClass()}">` +
    (subtitle === undefined
      ? heading
      : `<div class="${sheetHeadingClass()}">${heading}<p class="${sheetSubtitleClass()}">${escapeHtml(subtitle)}</p></div>`) +
    `<button class="icon-btn press" type="button" aria-label="Close" ${close}>${iconHtml("close", "lg")}</button></div>`
  );
}

export interface MenuItemOptions {
  act: string;
  glyph: IconName;
  label: string;
  disabled?: boolean;
  /** The danger tone, for the one row that destroys. */
  tone?: "danger";
  /** For placing the row where it stands. Never its look. */
  extraClass?: string;
}

/**
 * A menu's row, as Menu.astro's slot holds them: its glyph at the start, then the word.
 * Carries role="menuitem" and data-act for click delegation.
 */
export function menuItemHtml({
  act,
  glyph,
  label,
  disabled = false,
  tone,
  extraClass = "",
}: MenuItemOptions): string {
  const cls = [menuItemClass(tone), extraClass].filter(Boolean).map(escapeHtml).join(" ");
  return `<button class="${cls}" type="button" role="menuitem" data-act="${escapeHtml(act)}"${disabled ? " disabled" : ""}>${iconHtml(glyph)}${escapeHtml(label)}</button>`;
}

export interface SettingsTextOptions {
  label: string;
  hint?: string;
}

/**
 * A row's text block (settings.css): the label and its quiet hint below it.
 * Escapes text safely.
 */
export function settingsTextHtml({ label, hint }: SettingsTextOptions): string {
  const hintHtml =
    hint !== undefined ? `<span class="settings-hint">${escapeHtml(hint)}</span>` : "";
  return `<div class="settings-text"><span class="settings-label">${escapeHtml(label)}</span>${hintHtml}</div>`;
}

export interface IconBtnOptions {
  label: string;
  glyph: IconName;
  className?: string;
  popoverTarget?: string;
  describedBy?: string;
  dataAttrs?: Record<string, string | boolean>;
}

/**
 * An icon button (buttons.css, .icon-btn.press): 44px target with ink margins and ARIA label.
 */
export function iconBtnHtml({
  label,
  glyph,
  className = "",
  popoverTarget,
  describedBy,
  dataAttrs = {},
}: IconBtnOptions): string {
  const cls = ["icon-btn press", className].filter(Boolean).map(escapeHtml).join(" ");
  const target = popoverTarget ? ` popovertarget="${escapeHtml(popoverTarget)}"` : "";
  const desc = describedBy ? ` aria-describedby="${escapeHtml(describedBy)}"` : "";
  const data = Object.entries(dataAttrs)
    .filter(([, value]) => value !== false)
    .map(([name, value]) =>
      value === true || value === ""
        ? ` ${escapeHtml(name)}`
        : ` ${escapeHtml(name)}="${escapeHtml(String(value))}"`,
    )
    .join("");
  return `<button class="${cls}" type="button" aria-label="${escapeHtml(label)}"${desc}${target}${data}>${iconHtml(glyph)}</button>`;
}
