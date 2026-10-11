import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * The source catalogue the Add a topic form offers from: config/source-catalog.json, read at build
 * time. An entry is an offer, not a source; nothing in it is fetched until the owner adds it.
 *
 * The engine writes the file and it may not exist yet, so a missing or malformed file is an empty
 * list, and a malformed entry is skipped, never guessed. Build time only: the page script gets the
 * entries as markup.
 */

export const CADENCES = ["daily", "several a week", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export interface CatalogSource {
  id: string;
  name: string;
  /** The site's own page, for a link; null when the entry names none. */
  url: string | null;
  /** The feed the add operation sends. */
  feed_url: string;
  about: string;
  cadence: Cadence | null;
  tags: string[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** An http or https address, or null. */
function webAddress(value: unknown): string | null {
  const text = asText(value);
  if (text === null) return null;
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && url.hostname !== "" ? url.href : null;
  } catch {
    return null;
  }
}

/** The sources in a parsed catalogue file, in the file's order. */
export function parseSourceCatalog(file: unknown): CatalogSource[] {
  if (!isRecord(file) || !Array.isArray(file.sources)) return [];
  const seen = new Set<string>();
  const sources: CatalogSource[] = [];
  for (const entry of file.sources) {
    if (!isRecord(entry)) continue;
    const id = asText(entry.id);
    const name = asText(entry.name);
    const feed = webAddress(entry.feed_url);
    const tags = Array.isArray(entry.tags)
      ? [...new Set(entry.tags.map(asText).filter((tag): tag is string => tag !== null))].map(
          (tag) => tag.toLowerCase(),
        )
      : [];
    if (!id || !ID.test(id) || seen.has(id) || !name || !feed || tags.length === 0) continue;
    seen.add(id);
    const cadence = CADENCES.find((known) => known === entry.cadence) ?? null;
    sources.push({
      id,
      name,
      url: webAddress(entry.url),
      feed_url: feed,
      about: asText(entry.about) ?? "",
      cadence,
      tags,
    });
  }
  return sources;
}

/** The site an address belongs to, without "www.": what an offer and a source are matched on. */
function siteOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The catalogue sources to offer: those whose site is not already one of the sources. */
export function freshOffers(
  catalog: readonly CatalogSource[],
  sources: ReadonlyArray<{ host: string }>,
): CatalogSource[] {
  const held = new Set(sources.map((source) => source.host).filter(Boolean));
  return catalog.filter((offer) => !held.has(siteOf(offer.feed_url)));
}

/** How often a source posts, as a short phrase for its row. */
export function cadenceLabel(cadence: Cadence | null): string {
  switch (cadence) {
    case "daily":
      return "Posts daily";
    case "several a week":
      return "Posts several times a week";
    case "weekly":
      return "Posts weekly";
    case "monthly":
      return "Posts monthly";
    default:
      return "";
  }
}

/** The line under a source's name: what it covers, then how often it posts. */
export function catalogLine(source: Pick<CatalogSource, "about" | "cadence">): string {
  return [source.about, cadenceLabel(source.cadence)].filter(Boolean).join(" · ");
}

/** The site a catalogue source lives on, as its row names it: its own page's host, else its feed's. */
export function catalogHost(source: Pick<CatalogSource, "url" | "feed_url">): string {
  return siteOf(source.url ?? source.feed_url);
}

// ------------------------------------------------------------------------------------ suggestions

/**
 * A word as a topic and a tag can meet on it: a plural is its singular ("phones" and "phone",
 * "stories" and "story", "movies" and "movie") and "-ing" is dropped ("learning" and "learn"). It is
 * only for meeting: the stem is never shown. Words of three letters or fewer are left as they are,
 * so "ios" and "css" stay themselves.
 */
function stem(word: string): string {
  let base = word;
  if (base.length > 4 && base.endsWith("ies")) base = `${base.slice(0, -3)}y`;
  else if (base.length > 4 && /(?:ch|sh|x|z|ss)es$/.test(base)) base = base.slice(0, -2);
  else if (base.length > 3 && base.endsWith("s") && !/(?:ss|us|is)$/.test(base)) {
    base = base.slice(0, -1);
  }
  if (base.length > 5 && base.endsWith("ing")) base = base.slice(0, -3);
  else if (base.length > 4 && base.endsWith("ie")) base = `${base.slice(0, -2)}y`;
  return base;
}

/**
 * Words that say nothing about what a topic covers: what a sentence is built from, and what kind of
 * coverage it is (news, launches, releases), which every topic says of itself. They are left out on
 * both sides, so no tag, description or name is ever matched on one. Each is kept as said and as
 * stemmed, so "releases" goes with "release".
 */
const STOP_WORDS = new Set(
  (
    "a about across after all also am an and any are around as at be because been but by can could " +
    "do does during each for from had has have how if in into is it its just launch like more most " +
    "new news of on only or other our out over release so some such than that the their them then " +
    "there these they this those through to up use used using very was we were what when where " +
    "which while who why will with within without would you your"
  )
    .split(" ")
    .flatMap((word) => [word, stem(word)]),
);

/**
 * The words in some text that a source can be matched on: lower case, with stop words, numbers and
 * single letters left out and the rest stemmed, in the order they were said.
 */
export function catalogWords(text: string): string[] {
  const words: string[] = [];
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const base = stem(word);
    if (word.length < 2 || /^\d+$/.test(word) || STOP_WORDS.has(word) || STOP_WORDS.has(base)) {
      continue;
    }
    words.push(base);
  }
  return words;
}

/**
 * What a topic and the catalogue call the same thing. A topic that says the first also looks for
 * the words after it. "ui" and "ux" look for "interface" and "interaction" but not the other way:
 * a topic about interaction patterns is not about UX sources.
 */
const ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["tech", ["technology"]],
  ["technology", ["tech"]],
  ["ai", ["artificial intelligence", "machine learning", "llm"]],
  ["artificial intelligence", ["ai"]],
  ["machine learning", ["ai"]],
  ["llm", ["ai"]],
  ["ui", ["interface", "interaction"]],
  ["ux", ["interface", "interaction"]],
];

const ALIAS_RULES = ALIASES.map(([said, also]) => ({
  said: ` ${catalogWords(said).join(" ")} `,
  also: also.flatMap(catalogWords),
}));

/** The words of each text, and the words their aliases add. */
function termsOf(texts: readonly string[]): Set<string> {
  const terms = new Set<string>();
  for (const text of texts) {
    const words = catalogWords(text);
    for (const word of words) terms.add(word);
    const said = ` ${words.join(" ")} `;
    for (const rule of ALIAS_RULES) {
      if (said.includes(rule.said)) for (const word of rule.also) terms.add(word);
    }
  }
  return terms;
}

/** What suggestSources reads of a topic: what it is called, what counts, and the words it goes by. */
export interface TopicWords {
  id?: string;
  name: string;
  description?: string;
  keywords?: readonly string[];
}

/**
 * The words a topic goes by, which a source's tags, description and name are looked up for: those of
 * its name, id, keywords and description, and what their aliases add. A description's "Not sports
 * results." says what the topic leaves out, so what follows a "not" in a sentence is not read.
 */
export function topicTerms(topic: TopicWords): Set<string> {
  const description = (topic.description ?? "").replace(
    /\b(?:not|excluding|except)\b[^.;!?\n]*/gi,
    " ",
  );
  return termsOf([topic.name, topic.id ?? "", ...(topic.keywords ?? []), description]);
}

/** A source already held: its site, and its own addresses when the caller has them. */
export interface HeldSource {
  host: string;
  url?: string | null;
  feed_url?: string | null;
}

/** A feed address as two spellings of it compare: no scheme, "www." or closing slash, in lower case. */
function feedKey(address: string): string {
  try {
    const url = new URL(address);
    return `${siteOf(address)}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch {
    return address.trim().toLowerCase();
  }
}

/** How well a source suits the words of a topic: its score, and how many of those words are its tags. */
function fit(source: CatalogSource, terms: ReadonlySet<string>): { score: number; tagged: number } {
  const tags = new Set(source.tags.flatMap(catalogWords));
  const about = new Set(catalogWords(source.about));
  const name = new Set(catalogWords(source.name));
  let tagged = 0;
  let mentioned = 0;
  for (const term of terms) {
    if (tags.has(term)) tagged += 1;
    if (about.has(term)) mentioned += 1;
    if (name.has(term)) mentioned += 1;
  }
  return { score: tagged * 3 + mentioned, tagged };
}

/**
 * The catalogue sources that fit a topic, best first, at most `limit`. A candidate is a source whose
 * site is not already read (freshOffers) and whose feed is not at an address already held. It fits
 * when one of the words the topic goes by (topicTerms) is one of its tags: the tags are the
 * catalogue's own vocabulary, so a description that only mentions a word, as many blurbs say
 * "company", is not enough. Each word scores 3 for a tag, 1 for being in the source's description
 * and 1 for being in its name, so the closest fit comes first, and a tie keeps the catalogue's order.
 * When nothing fits the answer is empty: the number is never made up with sources that do not.
 */
export function suggestSources(
  catalog: readonly CatalogSource[],
  sources: readonly HeldSource[],
  topic: TopicWords,
  limit = 5,
): CatalogSource[] {
  const terms = topicTerms(topic);
  const heldFeeds = new Set<string>();
  for (const source of sources) {
    for (const address of [source.feed_url, source.url])
      if (address) heldFeeds.add(feedKey(address));
  }
  return freshOffers(catalog, sources)
    .filter((offer) => !heldFeeds.has(feedKey(offer.feed_url)))
    .map((offer, order) => ({ offer, order, ...fit(offer, terms) }))
    .filter((entry) => entry.tagged > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.offer);
}

export interface LoadCatalogOptions {
  root?: string;
  env?: Record<string, string | undefined>;
}

/** Reads the catalogue. With DISPATCH_FIXTURES=1 it reads the invented one, so a real build never shows it. */
export async function loadSourceCatalog(
  options: LoadCatalogOptions = {},
): Promise<CatalogSource[]> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  try {
    return parseSourceCatalog(
      JSON.parse(await readFile(join(base, "config", "source-catalog.json"), "utf8")),
    );
  } catch {
    return [];
  }
}
