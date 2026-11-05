/**
 * The Health page's one sheet (health.astro, the design system's Sheet): a problem's detail, or Fix
 * all. It slides up on a phone and is a panel at the right from 40rem, so the page keeps one row a
 * problem and the words wait here (2026-11-05, the owner: "a big wall of text", "hide them inside a
 * bottom sheet on mobile and sidebar on desktop"). A problem's sheet: its reading, what it means for
 * readers, where to start (lib/healthHelp.ts), the week's commonest reports, then its prompt for an
 * AI agent with Copy (healthPrompts.ts).
 */
import { sheetGestures } from "../../../web/src/scripts/pullDismiss";
import { helpFor } from "../lib/healthHelp";
import { copyButton } from "../lib/problem";
import { allPrompt, issuePrompt, type PromptInput, reading } from "./healthPrompts";
import { element, glyph } from "./healthRing";
import { type Issue, nameOf } from "./healthSummary";

const sheet = document.querySelector<HTMLDialogElement>("dialog[data-health-sheet]");
if (sheet) {
  sheet.querySelector("[data-panel-close]")?.addEventListener("click", () => sheet.close());
  sheetGestures(sheet);
}

/** A part of the sheet: its heading, then what it holds. */
function part(title: string, ...children: Node[]): HTMLElement {
  const box = element("section", "hl-detail-part");
  box.append(element("h3", "hl-detail-head", title), ...children);
  return box;
}

/**
 * The prompt: its heading and Copy, then its whole text as a snippet.
 * shortcut: the snippet is drawn here until the design system's Snippet part lands (rolling DS PR
 * #705); then this draws that part.
 */
function promptPart(text: string): HTMLElement {
  const box = element("section", "hl-detail-part");
  const head = element("div", "hl-detail-row");
  const name = element("h3", "hl-detail-head", "Prompt for an AI agent");
  name.id = "hl-prompt-head";
  const copy = copyButton("Copy", () => text);
  copy.setAttribute("aria-describedby", name.id);
  head.append(name, copy);
  const snippet = element("pre", "hl-snippet", text);
  snippet.setAttribute("aria-labelledby", name.id);
  box.append(head, snippet);
  return box;
}

function show(title: string, parts: HTMLElement[]): void {
  if (!sheet) return;
  const heading = sheet.querySelector<HTMLElement>("#hl-sheet-title");
  if (heading) heading.textContent = title;
  sheet.querySelector("[data-sheet-content]")?.replaceChildren(...parts);
  sheet.querySelector(".sheet-body")?.scrollTo(0, 0);
  if (!sheet.open) sheet.showModal();
}

/** A problem's sheet. */
export function openIssue(issue: Issue, input: PromptInput): void {
  const help = helpFor(issue.row.id);
  const line = element("p", "hl-detail-reading");
  const mark = glyph(issue.row.tone);
  if (mark) {
    const icon = element("span", "ov-flag-icon");
    icon.dataset.tone = issue.row.tone;
    icon.append(mark);
    line.append(icon);
  }
  line.append(element("span", "", reading(issue)));
  const parts = [line];
  if (help) {
    parts.push(
      part("What it means", element("p", "hl-detail-text", help.means)),
      part("Where to start", element("p", "hl-detail-text", help.start)),
    );
  }
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
    parts.push(part("Commonest errors this week", list));
  }
  parts.push(promptPart(issuePrompt(issue, input)));
  show(nameOf(issue), parts);
}

/** Fix all: every problem and every failed load in one prompt. */
export function openAll(input: PromptInput): void {
  const count = input.issues.length + input.problems.length;
  show(`Fix all ${count}`, [
    element(
      "p",
      "hl-detail-text",
      "One prompt with every problem on this page and every part that failed to load.",
    ),
    promptPart(allPrompt(input)),
  ]);
}
