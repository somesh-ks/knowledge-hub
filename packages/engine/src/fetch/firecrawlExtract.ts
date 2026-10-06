import type { RawItem } from "../normalize/buildItem.js";
import { canonicalizeUrl } from "../normalize/canonicalizeUrl.js";
import { collapseWhitespace } from "../normalize/htmlToText.js";
import { slugify } from "../normalize/slugify.js";

/** Links per page that may stand in as undated entries, when a page shows no dates at all. */
export const UNDATED_LIMIT = 3;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_PATTERN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const MONTH_DAY_YEAR = new RegExp(
  `\\b${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,
  "i",
);
const DAY_MONTH_YEAR = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?,?\\s+(20\\d{2})\\b`,
  "i",
);

const LINK = /(!?)\[([^\]]{2,300})\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g;

function monthIndex(name: string): number {
  const prefix = name.slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.startsWith(prefix));
}

function utcDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(Date.UTC(year, month, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
  return valid ? date : undefined;
}

/** First calendar date written in the text: ISO, "October 5, 2026" or "5 October 2026". */
export function findDate(text: string): Date | undefined {
  const iso = ISO_DATE.exec(text);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const mdy = MONTH_DAY_YEAR.exec(text);
  if (mdy?.[1] && mdy[2] && mdy[3])
    return utcDate(Number(mdy[3]), monthIndex(mdy[1]), Number(mdy[2]));
  const dmy = DAY_MONTH_YEAR.exec(text);
  if (dmy?.[1] && dmy[2] && dmy[3])
    return utcDate(Number(dmy[3]), monthIndex(dmy[2]), Number(dmy[1]));
  return undefined;
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function stripMarkdown(text: string): string {
  return collapseWhitespace(
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`#>]+/g, " "),
  );
}

interface LinkCandidate {
  line: number;
  text: string;
  url: string;
}

function linkCandidates(lines: readonly string[], pageUrl: string): LinkCandidate[] {
  const pageCanonical = canonicalizeUrl(pageUrl);
  const pageHost = hostOf(pageUrl);
  const pagePath = new URL(pageUrl).pathname.replace(/\/+$/, "");
  const seen = new Set<string>();
  const found: LinkCandidate[] = [];

  lines.forEach((line, index) => {
    for (const match of line.matchAll(LINK)) {
      if (match[1] === "!") continue;
      const text = stripMarkdown(match[2] ?? "");
      const target = (match[3] ?? "").replace(/^<|>$/g, "");
      if (/^(#|mailto:|tel:|javascript:)/i.test(target)) continue;
      let resolved: string;
      try {
        resolved = new URL(target, pageUrl).toString();
      } catch {
        continue;
      }
      const canonical = canonicalizeUrl(resolved);
      if (!canonical || canonical === pageCanonical || seen.has(canonical)) continue;
      if (hostOf(resolved) !== pageHost) continue;
      const path = new URL(resolved).pathname.replace(/\/+$/, "");
      if (path === "") continue;
      // On a section page, posts live under it; on a homepage any deep link is a candidate.
      if (pagePath !== "" && !path.startsWith(`${pagePath}/`)) continue;
      // Navigation labels are short; headlines have several words.
      if (text.length < 12 || text.split(" ").length < 3) continue;
      seen.add(canonical);
      found.push({ line: index, text, url: resolved });
    }
  });
  return found;
}

/** Date nearest to a link line, stopping at lines that belong to another link. */
function dateAround(
  lines: readonly string[],
  index: number,
  linkLines: ReadonlySet<number>,
): Date | undefined {
  const own = findDate(lines[index] ?? "");
  if (own) return own;
  for (let distance = 1; distance <= 3; distance++) {
    for (const at of [index + distance, index - distance]) {
      if (at < 0 || at >= lines.length) continue;
      if (linkLines.has(at)) continue;
      const found = findDate(lines[at] ?? "");
      if (found) return found;
    }
  }
  return undefined;
}

export interface ExtractedEntries {
  /** Entries whose link or heading has a date. */
  dated: RawItem[];
  /** Heading entries that need fragment identity (single-page changelogs). */
  headings: RawItem[];
  /** Leading links of a page that shows no dates, capped. */
  undated: RawItem[];
}

/**
 * Pull recent entries out of a feedless page's markdown. Heuristics only: a dated link, then a
 * dated heading (anchor identity), then the first few links of an undated page. An empty result
 * is normal and the caller falls back to one item for the page.
 */
export function extractEntries(markdown: string, pageUrl: string): ExtractedEntries {
  const lines = markdown.split("\n");
  const candidates = linkCandidates(lines, pageUrl);
  const linkLines = new Set(candidates.map((c) => c.line));

  const dated: RawItem[] = [];
  const undatedLinks: RawItem[] = [];
  for (const candidate of candidates) {
    const date = dateAround(lines, candidate.line, linkLines);
    const raw: RawItem = { url: candidate.url, title: candidate.text, publishedAt: date };
    if (date) dated.push(raw);
    else undatedLinks.push(raw);
  }

  const headings: RawItem[] = [];
  if (dated.length === 0) {
    const used = new Set<string>();
    lines.forEach((line, index) => {
      const heading = /^#{1,4}\s+(.+)$/.exec(line);
      if (!heading?.[1]) return;
      const text = stripMarkdown(heading[1]);
      const date = findDate(text) ?? findDate(lines.slice(index + 1, index + 4).join("\n"));
      if (!date || text.length < 4) return;
      const slug = slugify(text);
      if (slug === "" || used.has(slug)) return;
      used.add(slug);
      headings.push({
        url: `${pageUrl.replace(/#.*$/, "")}#${slug}`,
        title: text,
        publishedAt: date,
      });
    });
  }

  const undated =
    dated.length === 0 && headings.length === 0 ? undatedLinks.slice(0, UNDATED_LIMIT) : [];
  return { dated, headings, undated };
}
