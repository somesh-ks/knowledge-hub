/**
 * The Health page's summary (health.astro): the tiles, Overall then one a section, each a link to its
 * section; then a row a check that needs a look, its name, its reading and a glyph, which opens its
 * sheet with what it means, where to start and its prompt for an agent (healthSheet.ts). The page
 * keeps one line a problem; the words are in the sheet. 2026-11-05, the owner: "no blue boxes", "a
 * human can easily understand what is wrong", then "a big wall of text ... hide them inside a bottom
 * sheet on mobile and sidebar on desktop".
 */
import type { HealthSeries } from "../../../web/src/lib/healthRows";
import { iconHtml } from "../../../web/src/lib/sheetHead";
import type { Pillar } from "../lib/pillars";
import {
  element,
  glyph,
  type HealthBody,
  isFlag,
  type Judged,
  judge,
  stateOf,
  type Tone,
  toneOf,
  WEIGHT,
} from "./healthRing";

type Row = HealthBody["rows"][number];
export interface Issue {
  section: Judged;
  label: string;
  row: Row;
  reports: HealthSeries["errors"][string]["top"];
}

/** An issue's name: its section, then its check, without the section said twice ("Budget: Cost"). */
export const nameOf = (issue: Issue): string =>
  `${issue.section.title} · ${issue.label.replace(/^Budget: /, "")}`;

/** Fills the tiles health.astro drew: state, glyph, how many are fine, the tint of what needs a look. */
function fillTiles(root: HTMLElement, groups: Judged[]): void {
  const all: Judged = { id: "all", title: "Overall", items: groups.flatMap((g) => g.items) };
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const tile of root.querySelectorAll<HTMLElement>("[data-tile]")) {
    const id = tile.dataset.tile ?? "";
    const g = id === "all" ? all : byId.get(id);
    const tone: Tone = g?.items.length ? toneOf(g) : "none";
    tile.dataset.tone = tone;
    const value = tile.querySelector<HTMLElement>("[data-value]");
    if (value) value.textContent = g?.items.length ? stateOf(g) : "No data";
    const mark = tile.querySelector<HTMLElement>("[data-mark]");
    if (mark) {
      mark.dataset.tone = tone;
      const copy = tone === "none" ? null : glyph(tone);
      mark.replaceChildren(...(copy ? [copy] : []));
    }
    const fine = g ? g.items.filter((x) => !isFlag(x.row.tone)).length : 0;
    const detail = tile.querySelector<HTMLElement>("[data-detail]");
    if (detail)
      detail.textContent = !g?.items.length
        ? "Not checked"
        : fine === g.items.length
          ? `All ${fine} fine`
          : `${fine} of ${g.items.length} fine`;
  }
}

/**
 * A problem's row, the design system's row action: its name, then its reading with its glyph at the
 * end, as a list row says its value (the name truncates, the reading never), and a chevron. It opens
 * the sheet with the rest.
 */
function issueRow(issue: Issue, open: (issue: Issue) => void): HTMLElement {
  const row = element("button", "row-action hl-issue-row");
  (row as HTMLButtonElement).type = "button";
  const text = element("span", "settings-text");
  const value = element("span", "settings-hint");
  const mark = glyph(issue.row.tone);
  if (mark) {
    const icon = element("span", "ov-flag-icon");
    icon.dataset.tone = issue.row.tone;
    icon.append(mark);
    value.append(icon);
  }
  value.append(issue.row.value);
  text.append(element("span", "settings-label", nameOf(issue)), value);
  row.append(text);
  row.insertAdjacentHTML("beforeend", iconHtml("chevronRight"));
  row.title = issue.row.detail;
  row.addEventListener("click", () => open(issue));
  return row;
}

/**
 * Draws the summary from an answer of /api/health: the tiles, the count of what needs a look, and a row
 * an issue, worst first, in the page's section order. Returns the issues and how many checks are fine.
 */
export function drawSummary(
  root: HTMLElement,
  body: HealthBody & { series?: HealthSeries },
  pillars: Pillar[],
  open: (issue: Issue) => void,
): { issues: Issue[]; fine: number } {
  const groups = judge(body, pillars);
  fillTiles(root, groups);
  const issues: Issue[] = groups.flatMap((section) =>
    section.items
      .filter((x) => isFlag(x.row.tone))
      .sort((a, b) => WEIGHT[a.row.tone] - WEIGHT[b.row.tone])
      .map((x) => ({
        section,
        label: x.label,
        row: x.row,
        reports: body.series?.errors[x.row.id]?.top ?? [],
      })),
  );
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const title = root.querySelector<HTMLElement>("[data-issues-title]");
  if (title)
    title.textContent = issues.length
      ? `${issues.length === 1 ? "1 thing needs" : `${issues.length} things need`} you`
      : "Nothing needs you";
  root
    .querySelector<HTMLElement>("[data-issues]")
    ?.replaceChildren(...issues.map((issue) => issueRow(issue, open)));
  return { issues, fine: total - issues.length };
}
