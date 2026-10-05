import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const NOISE = "script, style, noscript, template, iframe, svg, canvas, object, embed, link, meta";
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption, dt, dd, td";

/** Collapse runs of whitespace inside one paragraph. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

/** Leaf block elements in document order, one paragraph each, preserving paragraph breaks. */
function blocksToText(root: ParentNode): string {
  const paragraphs: string[] = [];
  for (const element of Array.from(root.querySelectorAll(BLOCKS))) {
    // A blockquote or list item that wraps other blocks is read through those blocks instead.
    if (element.querySelector(BLOCKS)) continue;
    const text =
      element.tagName.toLowerCase() === "pre"
        ? (element.textContent ?? "").replace(/\r\n/g, "\n").trim()
        : tidy(element.textContent ?? "");
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

/** Plain text of an HTML fragment: scripts and styles removed, one paragraph per block. */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const node of Array.from(document.querySelectorAll(NOISE))) node.remove();
  const blocks = blocksToText(document);
  if (blocks) return blocks;
  return tidy(document.body?.textContent ?? "");
}

/** Text from content that may be plain or HTML. Feed snippets and content fields are either. */
export function plainTextOf(content: string): string {
  return looksLikeHtml(content) ? htmlToText(content) : content.replace(/\r\n/g, "\n").trim();
}

/**
 * Main article text of a full web page. Readability picks the article body; its cleaned HTML is
 * then walked block by block so paragraph breaks survive. Returns an empty string when the page
 * holds no readable article, which is what a JavaScript-rendered page looks like.
 */
export function articleText(html: string): string {
  const { document } = parseHTML(html);
  for (const node of Array.from(document.querySelectorAll(NOISE))) node.remove();
  let article: { content?: string | null; textContent?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  if (article?.content) {
    const fromBlocks = htmlToText(article.content);
    if (fromBlocks.length >= 200) return fromBlocks;
    const flat = tidy(article.textContent ?? "");
    if (flat.length > fromBlocks.length) return flat;
    return fromBlocks;
  }
  return blocksToText(document);
}
