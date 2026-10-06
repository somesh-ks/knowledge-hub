export interface MdRow {
  /** Section heading such as "Lab & Frontier Engineering Blogs (Direct Scrape)". */
  heading: string;
  /** Top-level section heading such as "AI / ML / Frontier Research". */
  section: string;
  name: string;
  url: string;
  /** The Cadence column when the table has one. */
  cadence: string | undefined;
}

export interface ParsedSourcesMd {
  rows: MdRow[];
  /** Search queries from the "Exa Search Queries" code block, quotes removed. */
  exaQueries: string[];
  /** URLs from the "Firecrawl Watch URLs" code block. */
  watchUrls: string[];
}

const URL_PATTERN = /https?:\/\/[^\s)|`<>]+/;

function cleanCell(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isSeparator = (line: string): boolean => /^\|[\s:|-]+\|?$/.test(line.trim());

/** First URL in the row, with sentence punctuation trimmed. */
function urlOf(cells: readonly string[]): string | undefined {
  for (const cell of cells) {
    const match = URL_PATTERN.exec(cell);
    if (match) return match[0].replace(/[.,;]+$/, "");
  }
  return undefined;
}

/**
 * Read the tables and code blocks of config/sources.md. Layout-tolerant: any table whose rows
 * hold a name and a URL yields rows, and the two fenced blocks are told apart by their section
 * heading. Rows without a URL (prose, summary tables) are skipped.
 */
export function parseSourcesMd(markdown: string): ParsedSourcesMd {
  const rows: MdRow[] = [];
  const exaQueries: string[] = [];
  const watchUrls: string[] = [];

  let section = "";
  let heading = "";
  let header: string[] | undefined;
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      const text = line.trim();
      if (text === "") continue;
      if (/exa search queries/i.test(section)) {
        const quoted = /^"(.+)"$/.exec(text);
        if (quoted?.[1]) exaQueries.push(quoted[1]);
      } else if (/firecrawl watch/i.test(section) && /^https?:\/\//.test(text)) {
        watchUrls.push(text);
      }
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2?.[1]) {
      section = cleanCell(h2[1]);
      heading = section;
      header = undefined;
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3?.[1]) {
      heading = cleanCell(h3[1]);
      header = undefined;
      continue;
    }

    if (!line.trim().startsWith("|")) {
      header = undefined;
      continue;
    }
    if (isSeparator(line)) continue;
    const cells = splitRow(line);
    if (header === undefined) {
      header = cells.map((cell) => cleanCell(cell).toLowerCase());
      continue;
    }
    const url = urlOf(cells);
    const name = cleanCell(cells[0] ?? "");
    if (!url || name === "") continue;
    const cadenceColumn = header.findIndex((title) => title.includes("cadence"));
    rows.push({
      heading,
      section,
      name,
      url,
      cadence: cadenceColumn >= 0 ? cleanCell(cells[cadenceColumn] ?? "") || undefined : undefined,
    });
  }
  return { rows, exaQueries, watchUrls };
}
