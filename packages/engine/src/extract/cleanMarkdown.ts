/**
 * Page Markdown to prose, once, for every path that turns a scraped page into text for the judge or
 * the writer (D232). Firecrawl's `onlyMainContent` still lets through the skip link, the menu, a
 * cookie banner, share buttons, bare URLs and a footer; the whole-page fallback in `firecrawl.ts`
 * and `markdownToText` both used to pass them on as the story's words.
 */

/** A line that is nothing but links is a menu, a breadcrumb or a share row, not a sentence. */
const MAX_NAV_LINK_CHARS = 40;
const MAX_BOILERPLATE_LINE_CHARS = 200;

const LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

/** Page furniture that survives main-content extraction. Only ever matched on a short line. */
const BOILERPLATE: readonly RegExp[] = [
  /^skip to (main )?content\b/i,
  /\bcookies?\b.*\b(accept|consent|settings|preferences|banner|policy|manage)\b/i,
  /\b(accept|reject|decline) (all|cookies)\b/i,
  /\bwe use cookies\b/i,
  /^(subscribe|sign up|join)\b.*\b(newsletter|updates|mailing list|inbox)\b/i,
  /^(share|follow us|tweet)\b.*\b(x|twitter|facebook|linkedin|reddit|email|link)\b/i,
  /^(copy|share) (link|this)\b/i,
  /^(related|more) (posts|articles|stories|reading)\b/i,
  /\ball rights reserved\b/i,
  /^(©|\(c\)|copyright)\s/i,
  /^(privacy|terms)( policy| of (use|service))?( [|·•-] .*)?$/i,
  /^(on this page|table of contents)$/i,
  /^(previous|next) (post|article)\b/i,
];

/** A line made only of links and the separators between them. */
function isLinkRow(line: string): boolean {
  const withoutBullet = line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "");
  const texts = [...withoutBullet.matchAll(LINK)].map((match) => (match[1] ?? "").trim());
  if (texts.length === 0) return false;
  const rest = withoutBullet.replace(LINK, "").replace(/[\s|·•>/,:–—-]+/g, "");
  if (rest !== "") return false;
  return texts.every((text) => text.length <= MAX_NAV_LINK_CHARS && !/[.!?]$/.test(text));
}

function isBoilerplate(line: string): boolean {
  const text = line.trim();
  return (
    text.length <= MAX_BOILERPLATE_LINE_CHARS && BOILERPLATE.some((pattern) => pattern.test(text))
  );
}

/**
 * Tags a scraper left in the Markdown. A script or style block goes with its contents. Removal
 * repeats until the text stops changing: taking out one tag can join the halves of another
 * (`<scr<b>ipt>`).
 */
function dropMarkup(markdown: string): string {
  let text = markdown;
  let previous: string;
  do {
    previous = text;
    text = text
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[a-z][^>]*>/gi, "");
  } while (text !== previous);
  // Whatever still opens a tag (an unclosed `<scr` at the end of a page) loses its bracket.
  return text.replace(/<(?=[a-z!/])/gi, "");
}

/**
 * The page's own words: furniture lines and bare URLs removed, links reduced to their text, images
 * and Markdown marks gone, paragraphs kept.
 */
export function cleanMarkdown(markdown: string): string {
  const lines = dropMarkup(markdown.replace(/\r\n/g, "\n"))
    .split("\n")
    .filter((line) => !isLinkRow(line) && !isBoilerplate(line))
    .map((line) =>
      line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        // A link whose text is its own address says nothing; any other link keeps its text.
        .replace(/\[\s*https?:\/\/[^\]\s]*\s*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/<?\bhttps?:\/\/[^\s)>\]]+>?/gi, ""),
    );
  return lines
    .join("\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/^```.*$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
