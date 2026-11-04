/**
 * The markup of a sheet's header row and of an icon, written once for the Astro components
 * (SheetHeader.astro, Icon.astro) and for the sheets a script builds, so a sheet a script builds
 * is the same sheet a page builds (the design-system audit, 2026-10-25).
 */
import { type IconSize, iconClass } from "../design-system/icon";
import { MENU_BACK } from "../design-system/menu";
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
  back = false,
): string {
  const data = Object.entries(titleData)
    .filter(([, value]) => value !== false)
    .map(([name, value]) =>
      value === true || value === "" ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`,
    )
    .join("");
  const heading = `<h2 class="${sheetTitleClass()}" id="${titleId}"${data}>${escapeHtml(title)}</h2>`;
  return (
    `<div class="${sheetHeadClass()}"${back ? " data-has-back" : ""}>` +
    (back
      ? `<button class="icon-btn press" type="button" aria-label="Back" ${MENU_BACK}>${iconHtml("chevronLeft", "lg")}</button>`
      : "") +
    (!subtitle
      ? heading
      : `<div class="${sheetHeadingClass()}">${heading}<p class="${sheetSubtitleClass()}">${escapeHtml(subtitle)}</p></div>`) +
    `<button class="icon-btn press" type="button" aria-label="Close" ${close}>${iconHtml("close", "lg")}</button></div>`
  );
}
