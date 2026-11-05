/**
 * The Health page's summary (health.astro): the tiles, Overall then one a section, each a link to its
 * section; then every check that needs a look, each with what it means for readers and where to start
 * (lib/healthHelp.ts), an error row with the week's commonest reports. The prompts that hand them to an
 * AI agent are the Actions section's (healthActions.ts). 2026-11-05, the owner: "no blue boxes", "a
 * human can easily understand what is wrong ... and share it with the ai agent to fix".
 */
import type { HealthSeries } from "../../../web/src/lib/healthRows";
import { helpFor } from "../lib/healthHelp";
import type { Pillar } from "../lib/pillars";
import {
  element,
  glyph,
  type HealthBody,
  isFlag,
  type Judged,
  judge,
  line,
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

/** One issue on the page: its line (a link to its section), what it means, where to start, its reports. */
function issueEl(issue: Issue, link: string): HTMLElement {
  const item = element("li", "hl-issue");
  const help = helpFor(issue.row.id);
  item.append(line(nameOf(issue), issue.row, link));
  const body = element("div", "hl-issue-body");
  if (help) body.append(element("p", "hl-issue-text", help.means));
  body.append(element("p", "hl-issue-start", `${issue.row.detail}.`));
  if (help) body.append(element("p", "hl-issue-start", `Start: ${help.start}`));
  if (issue.reports.length) {
    const list = element("ul", "hl-reports");
    list.setAttribute("role", "list");
    for (const r of issue.reports) {
      const li = element("li", "hl-report");
      li.append(
        element("span", "hl-report-message", `"${r.message}"`),
        element("span", "hl-report-where", `${r.page}, ${r.week} this week`),
      );
      list.append(li);
    }
    body.append(list);
  }
  item.append(body);
  return item;
}

/**
 * Draws the summary from an answer of /api/health: the tiles, the count of what needs a look, and each
 * issue, worst first, in the page's section order. Returns the issues, which the Actions section words
 * as prompts.
 */
export function drawSummary(
  root: HTMLElement,
  body: HealthBody & { series?: HealthSeries },
  pillars: Pillar[],
  linkFor: (pillar: string) => string,
): Issue[] {
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
    ?.replaceChildren(...issues.map((issue) => issueEl(issue, linkFor(issue.section.id))));
  const rest = root.querySelector<HTMLElement>("[data-issues-rest]");
  if (rest)
    rest.textContent = issues.length
      ? `The other ${total - issues.length} checks are fine. Prompts to fix them are in Actions.`
      : `All ${total} checks are fine.`;
  return issues;
}
