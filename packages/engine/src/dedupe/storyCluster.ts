import { type Item, TRENDING_WINDOW_HOURS } from "@singularity/core";

/**
 * Story clustering for the consumer tech beat. Several outlets cover one launch under headlines
 * that share little beyond the product name ("Apple announces the iPad Pro with M5 chip",
 * "M5 iPad Pro arrives with a faster GPU"), which the near-duplicate pass, built for the same
 * article syndicated twice, cannot see at its 0.8 title threshold.
 *
 * Titles are reduced to product tokens (brand, model names and numbers) and compared with a
 * weighted Jaccard similarity. The best item of each cluster is kept, the rest are absorbed into
 * it, and the number of different sources is recorded as `signals.coverage`, which the prefilter
 * uses to rank tech candidates at no model cost.
 *
 * The word list and the thresholds were tuned on headline sets in the tests. They are heuristics:
 * two stories about one product inside the window can still merge (a launch and its teardown),
 * which costs the digest nothing, and two products are kept apart by their model tokens.
 *
 * The same clustering serves Trending (D40) through the "news" profile: general news has no
 * product or model tokens, so a headline is reduced to its names, numbers and content words, a
 * name or number counts double, and a pair must share a name or number. The window is 48 hours
 * and the number of different outlets is the coverage that ranks the story. Only the vocabulary
 * and the thresholds differ; the clustering loop is shared.
 */

/** Stories published further apart than this are not the same launch. */
export const STORY_WINDOW_HOURS = 72;

/** Weighted Jaccard similarity of two titles' product tokens at which they are one story. */
export const STORY_CLUSTER_THRESHOLD = 0.5;

/** How far the threshold drops for a pair that names the same model, to 0.4 by default. */
export const SHARED_MODEL_ALLOWANCE = 0.1;

/** A title needs this many product tokens to take part, and a pair must share this many. */
export const MIN_PRODUCT_TOKENS = 2;

/** A token that names a model ("m5", "s27", "wf-1000xm6", "16") counts double. */
const MODEL_TOKEN_WEIGHT = 2;

const HOUR_MS = 3_600_000;

/** Stories published further apart than this are not the same news story. */
export const NEWS_WINDOW_HOURS = TRENDING_WINDOW_HOURS;

/** Weighted Jaccard similarity of two headlines' news tokens at which they are one story. */
export const NEWS_CLUSTER_THRESHOLD = 0.4;

/** A pair of news headlines must share this many tokens, one of them a name or a number. */
export const NEWS_MIN_SHARED = 2;

/**
 * Words that say a launch happened, or pad a headline, without saying which product it was.
 * Removing them leaves the brand, the model and the few words that are specific to the story.
 */
const FILLER: ReadonlySet<string> = new Set(
  [
    // Function words.
    "a an the and or but nor of to in on at by for from with without within as is are was were be",
    "been being it its this that these those their his her you your we our us i my they them he she",
    "not no yes than then so if up out off over under into onto about after before during while",
    "more most less least all any some each every both just still now here there also too very",
    "can could will would may might should must has have had do does did get gets got getting",
    "go goes going went come comes coming came make makes made making say says said via per vs",
    "versus amid again once ever never yet already almost nearly much many few lot what how why",
    "when where who which whose thing things way ways",
    // Launch verbs.
    "launch launches launched launching announce announces announced announcing announcement",
    "unveil unveils unveiled unveiling reveal reveals revealed introduce introduces introduced",
    "debut debuts debuted release releases released releasing ship ships shipped shipping arrive",
    "arrives arrived arriving land lands landed drop drops dropped roll rolls rolling rolled",
    "rollout start starts starting started begin begins began bring brings brought add adds added",
    "adding tease teases teased teaser confirm confirms confirmed show shows showed shown",
    "showcase showcases detail details detailed tip tips tipped spotted surface surfaces surfaced",
    "hit hits open opens opened live available availability sale sales preorder preorders",
    "pre-order pre-orders order orders expected expect expects set sets take takes took taking",
    "give gives gave see sees saw seen look looks looked looking want wants need needs",
    // Words about the article, not the product.
    "official officially review reviews reviewed hands-on hands first impressions leak leaks",
    "leaked rumor rumors rumour rumours rumored rumoured report reports reported reportedly",
    "exclusive breaking update updates updated news new newest latest next next-gen upcoming",
    "today tomorrow yesterday week weeks month months year years date dates time everything know",
    "guide explained explainer comparison compared deal deals hot take opinion",
    // Generic product vocabulary every launch story uses.
    "price prices pricing priced cost costs cheaper cheap expensive specs spec specifications",
    "features feature design display screen camera cameras battery life charging chip chipset",
    "processor performance power powered storage ram model models version versions edition",
    "variant variants color colors colour colours base big bigger biggest small smaller smallest",
    "fast faster fastest good better best great improved improvement improvements upgrade",
    "upgrades upgraded thin thinner thinnest light lighter lightest long longer longest same old",
    "older real really finally top full early late",
  ]
    .join(" ")
    .split(" "),
);

/**
 * A price (dollar, euro, pound, yen or rupee sign) or a percentage: "$999", "20%". Checked on the
 * raw word, before punctuation is trimmed, because trimming would remove the sign and leave a
 * bare number.
 */
const PRICE_OR_PERCENT = /^[("'[]*(?:[$€£¥₹]\s*\d|\d[\d.,]*%)/;

/** A quantity with its unit, or a year: a fact about the product, not its name. */
const MEASURE =
  /^\d+(?:[.,]\d+)*-?(?:gb|tb|mb|kb|mah|wh|kwh|w|kw|hz|khz|mhz|ghz|mp|mm|cm|nm|km|mph|kg|g|lb|lbs|fps|nits|ppi|dpi|x|k|m|bn|inch|inches|in|hour|hours|hr|hrs|day|days|year|years|month|months|min|mins|minute|minutes|core|cores|bit|megapixel|megapixels|watt|watts|percent)$/;
const YEAR = /^(?:19|20)\d{2}$/;

/** "M5-powered" names the M5; the suffix only says how the product relates to it. */
const RELATION_SUFFIX = /-(?:powered|based|equipped|ready|compatible|series|class)$/;
const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const HAS_DIGIT = /\d/;

/**
 * The product tokens of a headline: lowercase, possessives and edge punctuation removed, filler,
 * prices, measurements and years dropped. Inner punctuation stays, so "wf-1000xm6" and "wi-fi"
 * remain one token each and a pair of earbuds is not mistaken for the headphones one letter away.
 */
export function productTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = title.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  for (const part of normalized.split(/\s+/)) {
    if (part === "" || PRICE_OR_PERCENT.test(part)) continue;
    const token = part
      .replace(EDGES, "")
      .replace(/'s$/, "")
      .replace(RELATION_SUFFIX, "")
      .replace(EDGES, "");
    if (token === "" || FILLER.has(token) || MEASURE.test(token) || YEAR.test(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

/** The tokens that name a model: anything with a digit left after measurements are removed. */
export function modelTokens(tokens: ReadonlySet<string>): Set<string> {
  return new Set([...tokens].filter((token) => HAS_DIGIT.test(token)));
}

function isSubset(small: ReadonlySet<string>, large: ReadonlySet<string>): boolean {
  for (const token of small) if (!large.has(token)) return false;
  return true;
}

/**
 * Two headlines name different products when both carry model tokens and neither set contains
 * the other: "Pixel 11 Pro" against "Pixel 11a", or "iPad Pro M5" against "iPad Air M4". A
 * headline with no model token at all cannot conflict.
 */
export function modelsConflict(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const modelsA = modelTokens(a);
  const modelsB = modelTokens(b);
  if (modelsA.size === 0 || modelsB.size === 0) return false;
  return !isSubset(modelsA, modelsB) && !isSubset(modelsB, modelsA);
}

const weightOf = (token: string): number => (HAS_DIGIT.test(token) ? MODEL_TOKEN_WEIGHT : 1);

/**
 * Similarity of two product-token sets, 0 to 1: shared weight over total weight, with model
 * tokens counting double. Zero when either headline is too thin, when they share fewer than two
 * tokens, or when their model tokens name different products.
 */
export function storySimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size < MIN_PRODUCT_TOKENS || b.size < MIN_PRODUCT_TOKENS) return 0;
  if (modelsConflict(a, b)) return 0;
  let sharedCount = 0;
  let shared = 0;
  let total = 0;
  for (const token of a) {
    total += weightOf(token);
    if (b.has(token)) {
      sharedCount += 1;
      shared += weightOf(token);
    }
  }
  for (const token of b) if (!a.has(token)) total += weightOf(token);
  if (sharedCount < MIN_PRODUCT_TOKENS) return 0;
  return shared / total;
}

/** True when both headlines carry the same model token: "m5" in both, "wf-1000xm6" in both. */
export function sharesModel(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const token of modelTokens(a)) if (b.has(token)) return true;
  return false;
}

/**
 * Whether two headlines report the same story. The bar is the threshold, lowered by
 * `SHARED_MODEL_ALLOWANCE` when both name the same model: outlets that agree on "M5" and
 * "iPad Pro" are describing one launch even when each adds its own detail to the headline.
 */
export function isSameStory(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
  threshold: number = STORY_CLUSTER_THRESHOLD,
): boolean {
  const similarity = storySimilarity(a, b);
  if (similarity === 0) return false;
  return similarity >= (sharesModel(a, b) ? threshold - SHARED_MODEL_ALLOWANCE : threshold);
}

/**
 * Words that carry no story in a news headline: function words, reporting verbs and the labels
 * outlets put on a piece ("live", "analysis"). Verbs like "signs" or "hits" are listed because two
 * unrelated stories share them far more often than two reports of one story depend on them.
 */
const NEWS_FILLER: ReadonlySet<string> = new Set(
  [
    "a an the and or but nor of to in on at by for from with without within as is are was were be",
    "been being it its this that these those their his her you your we our us i my they them he she",
    "not no yes than then so if up out off over under into onto about after before during while",
    "more most less least all any some each every both just still now here there also too very",
    "can could will would may might should must has have had do does did get gets got getting",
    "go goes going went come comes coming came make makes made making via per vs versus amid again",
    "once ever never yet already almost nearly much many few lot what how why when where who which",
    "whose thing things way ways",
    "say says said saying tell tells told reportedly report reports reported",
    "new newest latest breaking live update updates updated news today tonight tomorrow yesterday",
    "week weeks month months year years day days time watch video videos photos photo opinion",
    "analysis explained explainer know need needs want wants look looks see sees show shows",
    "sign signs signed call calls called urge urges urged warn warns warned vow vows plan plans",
    "planned hit hits seek seeks sought face faces faced take takes took lead leads set sets",
    "announce announces announced unveil unveils reveal reveals revealed",
    "first last next big major top key",
  ]
    .join(" ")
    .split(" "),
);

const NEWS_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** "kills", "killed" and "killing" are one word to a reader; a crude stem makes them one token. */
function newsStem(word: string): string {
  if (word.length < 5) return word;
  const stripped = word.replace(/(?:ing|ed|es|s)$/, "");
  return stripped.length >= 3 ? stripped.replace(/e$/, "") : word;
}

/**
 * The tokens of a news headline with their weights. A name (a capitalized word that does not open
 * the headline, or an acronym) and a number weigh 2; every other content word weighs 1. Filler,
 * years and punctuation drop out. The key is lowercase and lightly stemmed, so "Trump" at the
 * start of one headline matches "Trump" in the middle of another.
 */
export function newsTokens(title: string): Map<string, number> {
  const tokens = new Map<string, number>();
  const words = title.replace(/[\u2018\u2019]/g, "'").split(/\s+/);
  for (const [index, raw] of words.entries()) {
    const word = raw.replace(NEWS_EDGES, "").replace(/'s$/i, "").replace(NEWS_EDGES, "");
    if (word === "") continue;
    const lower = word.toLowerCase();
    if (NEWS_FILLER.has(lower) || YEAR.test(lower)) continue;
    const acronym = word.length >= 2 && word === word.toUpperCase() && /\p{L}/u.test(word);
    const heavy = acronym || (index > 0 && /^\p{Lu}/u.test(word)) || HAS_DIGIT.test(lower);
    const key = heavy ? lower : newsStem(lower);
    tokens.set(key, Math.max(tokens.get(key) ?? 0, heavy ? MODEL_TOKEN_WEIGHT : 1));
  }
  return tokens;
}

/**
 * Whether two news headlines report one story: they share at least two tokens, one of them a name
 * or a number, and the shared weight is at least the threshold of the combined weight.
 */
export function isSameNewsStory(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  threshold: number = NEWS_CLUSTER_THRESHOLD,
): boolean {
  if (a.size < NEWS_MIN_SHARED || b.size < NEWS_MIN_SHARED) return false;
  let sharedCount = 0;
  let sharedHeavy = false;
  let shared = 0;
  let total = 0;
  for (const [token, weight] of a) {
    const other = b.get(token);
    if (other === undefined) {
      total += weight;
      continue;
    }
    const w = Math.max(weight, other);
    total += w;
    shared += w;
    sharedCount += 1;
    if (w >= MODEL_TOKEN_WEIGHT) sharedHeavy = true;
  }
  for (const [token, weight] of b) if (!a.has(token)) total += weight;
  if (sharedCount < NEWS_MIN_SHARED || !sharedHeavy) return false;
  return shared / total >= threshold;
}

/** How a vocabulary reduces a headline and decides two headlines are one story. */
interface Profile {
  tokens(title: string): ReadonlyMap<string, number>;
  same(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>, threshold: number): boolean;
  threshold: number;
  windowHours: number;
}

const PROFILES: Record<"product" | "news", Profile> = {
  product: {
    tokens: (title) => new Map([...productTokens(title)].map((token) => [token, weightOf(token)])),
    same: (a, b, threshold) => isSameStory(new Set(a.keys()), new Set(b.keys()), threshold),
    threshold: STORY_CLUSTER_THRESHOLD,
    windowHours: STORY_WINDOW_HOURS,
  },
  news: {
    tokens: newsTokens,
    same: isSameNewsStory,
    threshold: NEWS_CLUSTER_THRESHOLD,
    windowHours: NEWS_WINDOW_HOURS,
  },
};

export interface ClusterInput {
  /** Which vocabulary to cluster with. "product" (the default) is the consumer tech beat. */
  profile?: "product" | "news";
  items: readonly Item[];
  /** Only these items are clustered. Everything else passes through untouched. */
  eligible: (item: Item) => boolean;
  /** Negative when `a` should be kept over `b`. A total order, so input order never matters. */
  compare: (a: Item, b: Item) => number;
  /** The kept item, enriched with what the dropped one knew. */
  absorb: (keep: Item, dropped: Item) => Item;
  /**
   * Sources an earlier pass already merged into an item, by item id, so that a twin the
   * near-duplicate pass absorbed still counts toward coverage.
   */
  outlets?: ReadonlyMap<string, ReadonlySet<string>>;
  threshold?: number;
  windowHours?: number;
}

export interface ClusterResult {
  /** Survivors in their input order. A cluster's best item stands in for the whole cluster. */
  items: Item[];
  /** Items absorbed into another. */
  merged: number;
}

interface Cluster {
  leader: Item;
  tokens: ReadonlyMap<string, number>;
  at: number;
  members: Item[];
  sources: Set<string>;
}

function timeOf(item: Item): number {
  const ms = Date.parse(item.published_at ?? item.fetched_at);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Merge items that report the same launch. Candidates are walked best first; each joins the
 * first cluster whose leader it resembles, comes from another source than, and was published
 * within the window of. Comparing against the leader only (never against other members) keeps a
 * chain of loosely related headlines from pulling two different products together.
 */
export function clusterStories(input: ClusterInput): ClusterResult {
  const profile = PROFILES[input.profile ?? "product"];
  const threshold = input.threshold ?? profile.threshold;
  const windowMs = (input.windowHours ?? profile.windowHours) * HOUR_MS;
  const candidates = input.items.filter(input.eligible).sort(input.compare);

  const clusters: Cluster[] = [];
  for (const item of candidates) {
    const tokens = profile.tokens(item.title);
    const at = timeOf(item);
    const home = clusters.find(
      (cluster) =>
        cluster.leader.source_id !== item.source_id &&
        Math.abs(cluster.at - at) <= windowMs &&
        profile.same(tokens, cluster.tokens, threshold),
    );
    const sources = new Set([item.source_id, ...(input.outlets?.get(item.id) ?? [])]);
    if (home) {
      home.members.push(item);
      for (const source of sources) home.sources.add(source);
    } else {
      clusters.push({ leader: item, tokens, at, members: [], sources });
    }
  }

  const replaced = new Map<string, Item>();
  const absorbed = new Set<string>();
  let merged = 0;
  for (const cluster of clusters) {
    if (cluster.members.length === 0 && cluster.sources.size < 2) continue;
    let kept = cluster.leader;
    for (const member of cluster.members) {
      kept = input.absorb(kept, member);
      absorbed.add(member.id);
      merged += 1;
    }
    replaced.set(cluster.leader.id, {
      ...kept,
      signals: { ...kept.signals, coverage: cluster.sources.size },
    });
  }

  const items = input.items
    .filter((item) => !absorbed.has(item.id))
    .map((item) => replaced.get(item.id) ?? item);
  return { items, merged };
}
