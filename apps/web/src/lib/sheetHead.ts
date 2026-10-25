/**
 * The markup of a sheet's header row and of an icon, written once for the Astro components
 * (SheetHeader.astro, Icon.astro) and for the lists a script redraws (structureView.ts), so a menu
 * a script builds is the same menu a page builds (the design-system audit, 2026-10-25).
 */
import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./icons";

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** One glyph, as Icon.astro draws it: `data-icon` names it for buttons.css's ink margins (D187). */
export const iconHtml = (name: IconName, className = ""): string =>
  `<svg class="${["icon", className].filter(Boolean).join(" ")}" data-icon="${name}" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"></path></svg>`;

export type SheetClose =
  | "data-create-close"
  | "data-panel-close"
  | "data-dialog-close"
  | "data-menu-close";

/**
 * A sheet's one header row (2026-10-20): the title at the start, Close at the end, in every sheet at
 * every width, as SheetFrame.tsx lays out. pullDismiss.ts and keyboardFit.ts find the row by
 * .create-sheet-head. The title is escaped here; `titleData` holds data attributes for the title.
 */
export function sheetHeadHtml(
  title: string,
  titleId: string,
  close: SheetClose,
  titleData: Record<`data-${string}`, string | boolean> = {},
): string {
  const data = Object.entries(titleData)
    .filter(([, value]) => value !== false)
    .map(([name, value]) =>
      value === true || value === "" ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`,
    )
    .join("");
  return (
    `<div class="create-sheet-head"><h2 class="sheet-title" id="${titleId}"${data}>${escapeHtml(title)}</h2>` +
    `<button class="icon-btn press" type="button" aria-label="Close" ${close}>${iconHtml("close", "icon-lg")}</button></div>`
  );
}
