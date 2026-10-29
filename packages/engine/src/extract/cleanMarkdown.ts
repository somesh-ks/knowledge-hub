/**
 * Page Markdown to prose, once, for every path that turns a scraped page into text for the judge or
 * the writer (D232). Firecrawl's `onlyMainContent` still lets through the skip link, the menu, a
 * cookie banner, share buttons, bare URLs and a footer; the whole-page fallback in `firecrawl.ts`
 * and `markdownToText` both used to pass them on as the story's words.
 */

/** Cookie-banner phrasing, not the topic: an article may explain how cookie consent works. */
const COOKIE_BANNER: readonly RegExp[] = [
  /\b(we|this (web)?site|our (web)?site) uses? cookies\b/i,
  /\b(accept|reject|decline) (all )?cookies\b/i,
  /\b(manage|cookie) (cookie )?(settings|preferences)\b/i,
];

/** A line that is nothing but links is a menu, a breadcrumb or a share row, not a sentence. */
const MAX_NAV_LINK_CHARS = 40;
const MAX_NAV_LINK_WORDS = 3;
const MAX_BOILERPLATE_LINE_CHARS = 200;
/** A cookie banner can run to a paragraph; its phrasing is specific enough to match at any length. */
const MAX_BANNER_LINE_CHARS = 600;

const LINK = /!?\[([^\]]*)\]\([^)]*\)/g;

/** Page furniture that survives main-content extraction. Only ever matched on a short line. */
const BOILERPLATE: readonly RegExp[] = [
  /^skip to (main )?content\b/i,
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
  // A lone link is a menu item only when it is a word or two; a longer one may be a linked statement.
  const maxWords = texts.length === 1 ? MAX_NAV_LINK_WORDS : Number.POSITIVE_INFINITY;
  return texts.every(
    (text) =>
      text.length <= MAX_NAV_LINK_CHARS &&
      text.split(/\s+/).length <= maxWords &&
      !/[.!?]$/.test(text),
  );
}

function isBoilerplate(line: string): boolean {
  const text = line.trim();
  if (text.length <= MAX_BANNER_LINE_CHARS && COOKIE_BANNER.some((pattern) => pattern.test(text))) {
    return true;
  }
  return (
    text.length <= MAX_BOILERPLATE_LINE_CHARS && BOILERPLATE.some((pattern) => pattern.test(text))
  );
}

const BLOCK_TAGS = ["script", "style", "noscript", "svg"];

/**
 * Tags, comments and script or style blocks a scraper left in the Markdown, in one scan: what is
 * cut is not rescanned, and a `<` that opens a tag with no closing `>` is dropped.
 */
function dropMarkupOnce(markdown: string): string {
  const lower = markdown.toLowerCase();
  let out = "";
  let at = 0;
  while (at < markdown.length) {
    const open = markdown.indexOf("<", at);
    if (open === -1) break;
    out += markdown.slice(at, open);
    const next = markdown[open + 1] ?? "";
    if (lower.startsWith("<!--", open)) {
      const end = markdown.indexOf("-->", open + 4);
      at = end === -1 ? markdown.length : end + 3;
    } else if (
      /[a-z/]/i.test(next) &&
      /[a-z]/i.test(markdown[open + (next === "/" ? 2 : 1)] ?? "")
    ) {
      const name = /^<\/?([a-z][a-z0-9]*)/i.exec(markdown.slice(open, open + 20))?.[1] ?? "";
      const closing = next === "/";
      const blockEnd =
        !closing && BLOCK_TAGS.includes(name.toLowerCase())
          ? lower.indexOf(`</${name.toLowerCase()}`, open)
          : -1;
      const from = blockEnd === -1 ? open : blockEnd;
      const end = markdown.indexOf(">", from);
      at = end === -1 ? markdown.length : end + 1;
    } else {
      out += "<";
      at = open + 1;
    }
  }
  return out + markdown.slice(at);
}

/** Repeats the scan until stable: cutting a tag can join the halves of another (`<!<!-- x -->-- y -->`). */
function dropMarkup(markdown: string): string {
  let text = markdown;
  for (let previous = ""; text !== previous; ) {
    previous = text;
    text = dropMarkupOnce(text);
  }
  return text;
}

/**
 * The page's own words: furniture lines and bare URLs removed, links reduced to their text, images
 * and Markdown marks gone, paragraphs kept.
 */
export function cleanMarkdown(markdown: string): string {
  const lines = dropMarkup(markdown.replace(/\r\n/g, "\n"))
    .split("\n")
    .filter((line) => {
      const body = line.replace(/^\s*#{1,6}\s+/, "");
      return !isLinkRow(body) && !isBoilerplate(body);
    })
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
