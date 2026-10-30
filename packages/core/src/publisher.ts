import type { SourceType } from "./item.js";

/**
 * Source types whose items are links to other publishers. Showing the registry name for these
 * ("Exa discovery", "Hacker News: Show HN") tells the reader nothing about where a story is from.
 */
export const AGGREGATOR_SOURCE_TYPES: readonly SourceType[] = [
  "exa",
  "hn",
  "lobsters",
  "producthunt",
  "reddit",
];

/** Display names for hosts this briefing links to often. Keys are bare hosts, without "www.". */
export const KNOWN_PUBLISHERS: Readonly<Record<string, string>> = {
  "theverge.com": "The Verge",
  "arstechnica.com": "Ars Technica",
  "github.com": "GitHub",
  "9to5google.com": "9to5Google",
  "9to5mac.com": "9to5Mac",
  "androidauthority.com": "Android Authority",
  "gsmarena.com": "GSMArena",
  "engadget.com": "Engadget",
  "electrek.co": "Electrek",
  "tomshardware.com": "Tom's Hardware",
  "techcrunch.com": "TechCrunch",
  "wired.com": "Wired",
  "macrumors.com": "MacRumors",
  "bloomberg.com": "Bloomberg",
  "reuters.com": "Reuters",
  "nytimes.com": "The New York Times",
  "technologyreview.com": "MIT Technology Review",
  "youtube.com": "YouTube",
  "arxiv.org": "arXiv",
  "dl.acm.org": "ACM Digital Library",
  "dev.to": "DEV Community",
  "medium.com": "Medium",
  "substack.com": "Substack",
  "smashingmagazine.com": "Smashing Magazine",
  "css-tricks.com": "CSS-Tricks",
  "tympanus.net": "Codrops",
  "web.dev": "web.dev",
  "developer.mozilla.org": "MDN",
  "developer.chrome.com": "Chrome for Developers",
  "webkit.org": "WebKit",
  "openai.com": "OpenAI",
  "anthropic.com": "Anthropic",
  "deepmind.google": "Google DeepMind",
  "blog.google": "Google",
  "apple.com": "Apple",
  "huggingface.co": "Hugging Face",
  "vercel.com": "Vercel",
  "figma.com": "Figma",
  "simonwillison.net": "Simon Willison",
  "news.ycombinator.com": "Hacker News",
  "lobste.rs": "Lobsters",
  "producthunt.com": "Product Hunt",
};

/** Lowercase host of a URL without a leading "www.", or "" when the URL cannot be parsed. */
export function publisherHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * The publisher behind a URL: a known name for the host or one of its parent domains
 * ("blog.github.com" reads as GitHub), otherwise the bare host. Empty for an unparseable URL.
 */
export function publisherName(url: string): string {
  const host = publisherHost(url);
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const known = KNOWN_PUBLISHERS[labels.slice(i).join(".")];
    if (known) return known;
  }
  return host;
}

/**
 * The source label a reader sees for an item. An item from an aggregator, or from a source the
 * registry marks as a list of links, is credited to the publisher of its URL; everything else
 * keeps its registry name.
 */
export function displaySource(input: {
  url: string;
  sourceType: SourceType;
  /** Registry name, or the source id when no name is known. */
  sourceName: string;
  /** True for a source whose items link elsewhere (a "newsletter-link" source). */
  linkSource?: boolean;
}): string {
  if (!input.linkSource && !AGGREGATOR_SOURCE_TYPES.includes(input.sourceType)) {
    return input.sourceName;
  }
  return publisherName(input.url) || input.sourceName;
}
