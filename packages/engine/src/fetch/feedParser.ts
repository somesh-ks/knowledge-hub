import { XMLParser } from "fast-xml-parser";

export interface FeedEntry {
  title: string | undefined;
  /** Absolute when it could be resolved. */
  link: string | undefined;
  /** Raw guid or atom id. */
  id: string | undefined;
  /** Publication date as written; the format varies by feed. */
  published: string | undefined;
  updated: string | undefined;
  author: string | undefined;
  /** Short description or atom summary, HTML or text. */
  summary: string | undefined;
  /** Full body (content:encoded or atom content), HTML or text. */
  content: string | undefined;
  /** media:description, used by YouTube feeds. */
  mediaDescription: string | undefined;
}

export interface ParsedFeed {
  format: "rss" | "atom" | "rdf";
  title: string | undefined;
  entries: FeedEntry[];
}

export class FeedParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "FeedParseError";
  }
}

const ARRAY_TAGS = new Set(["item", "entry", "link", "category", "author", "dc:creator"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of a parsed element: plain text, text with attributes, or nested xhtml. */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(textOf).filter((part): part is string => part !== undefined);
    return parts.length ? parts.join(" ") : undefined;
  }
  if (isNode(value)) {
    const direct = value["#text"];
    if (typeof direct === "string" && direct.trim() !== "") return direct;
    const parts: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("@_")) continue;
      const text = textOf(child);
      if (text !== undefined) parts.push(text);
    }
    return parts.length ? parts.join(" ") : undefined;
  }
  return undefined;
}

function resolveLink(href: string, baseUrl: string | undefined): string | undefined {
  try {
    return new URL(href.trim(), baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** The article link: RSS text links, or the alternate (else first plain) link of an atom entry. */
function pickLink(links: unknown, baseUrl: string | undefined): string | undefined {
  let fallback: string | undefined;
  for (const link of asArray(links)) {
    if (typeof link === "string") {
      const resolved = resolveLink(link, baseUrl);
      if (resolved) return resolved;
      continue;
    }
    if (!isNode(link)) continue;
    const href = typeof link["@_href"] === "string" ? link["@_href"] : textOf(link);
    if (!href) continue;
    const rel = typeof link["@_rel"] === "string" ? link["@_rel"] : "alternate";
    const resolved = resolveLink(href, baseUrl);
    if (!resolved) continue;
    if (rel === "alternate") return resolved;
    if (fallback === undefined && (rel === "related" || rel === "via")) fallback = resolved;
  }
  return fallback;
}

/** Names only: RSS authors often arrive as "address (Name)" or a bare address. */
function authorName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parenthesized = /\(([^)]+)\)/.exec(raw);
  if (parenthesized?.[1]) return parenthesized[1].trim();
  if (/^\S+@\S+$/.test(raw.trim())) return undefined;
  return raw.replace(/<[^>]*>/g, "").trim() || undefined;
}

function authorsOf(entry: Node): string | undefined {
  const names: string[] = [];
  for (const candidate of [...asArray(entry["dc:creator"]), ...asArray(entry.author)]) {
    const raw = isNode(candidate) ? textOf(candidate.name) : textOf(candidate);
    const name = authorName(raw);
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length ? names.slice(0, 3).join(", ") : undefined;
}

function guidOf(entry: Node): { value: string | undefined; permalink: boolean } {
  const guid = entry.guid;
  if (isNode(guid)) {
    return { value: textOf(guid), permalink: guid["@_isPermaLink"] !== "false" };
  }
  return { value: textOf(guid) ?? textOf(entry.id), permalink: true };
}

function mediaDescriptionOf(entry: Node): string | undefined {
  const group = entry["media:group"];
  if (isNode(group)) return textOf(group["media:description"]);
  return textOf(entry["media:description"]);
}

function toEntry(entry: Node, baseUrl: string | undefined): FeedEntry {
  const guid = guidOf(entry);
  let link = pickLink(entry.link, baseUrl);
  if (link === undefined && guid.permalink && guid.value && /^https?:\/\//i.test(guid.value)) {
    link = resolveLink(guid.value, baseUrl);
  }
  return {
    title: textOf(entry.title),
    link,
    id: guid.value,
    published:
      textOf(entry.published) ??
      textOf(entry.pubDate) ??
      textOf(entry["dc:date"]) ??
      textOf(entry.issued),
    updated: textOf(entry.updated) ?? textOf(entry.modified),
    author: authorsOf(entry),
    summary: textOf(entry.summary) ?? textOf(entry.description),
    content: textOf(entry["content:encoded"]) ?? textOf(entry.content),
    mediaDescription: mediaDescriptionOf(entry),
  };
}

/**
 * True when the text opens with an RSS, Atom or RDF root element rather than HTML. Looks only at
 * the start, after the XML prolog, comments and doctype, so markup inside item bodies (a feed
 * that quotes HTML in its first entry) cannot cause a false rejection.
 */
export function looksLikeFeed(text: string): boolean {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const head = text.slice(start, start + 4096).trimStart();
  const root = head.replace(/^(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)+/i, "");
  return /^<(?:rss|feed|rdf:rdf)[\s>]/i.test(root);
}

/**
 * Parse RSS 2.0, Atom or RDF (RSS 1.0). Relative links are resolved against `baseUrl`. Throws
 * FeedParseError for anything else, which includes HTML error pages served with status 200.
 */
export function parseFeed(xml: string, baseUrl?: string): ParsedFeed {
  let root: unknown;
  try {
    root = parser.parse(xml);
  } catch (error) {
    throw new FeedParseError("malformed XML", error);
  }
  if (!isNode(root)) throw new FeedParseError("not a feed");

  const rss = root.rss;
  if (isNode(rss) && isNode(rss.channel)) {
    const channel = rss.channel;
    return {
      format: "rss",
      title: textOf(channel.title),
      entries: asArray(channel.item)
        .filter(isNode)
        .map((e) => toEntry(e, baseUrl)),
    };
  }

  const atom = root.feed;
  if (isNode(atom)) {
    return {
      format: "atom",
      title: textOf(atom.title),
      entries: asArray(atom.entry)
        .filter(isNode)
        .map((e) => toEntry(e, baseUrl)),
    };
  }

  const rdf = root["rdf:RDF"];
  if (isNode(rdf)) {
    const channel = isNode(rdf.channel) ? rdf.channel : {};
    return {
      format: "rdf",
      title: textOf(channel.title),
      entries: asArray(rdf.item)
        .filter(isNode)
        .map((e) => toEntry(e, baseUrl)),
    };
  }
  throw new FeedParseError("not an RSS, Atom or RDF feed");
}
