import { type Category, type GeneralTopicId, type Source, TECH_CATEGORY } from "@singularity/core";

/** What the importer decides about a source beyond its name and URL. Keyed by source id. */
export interface Curation {
  high_signal?: boolean;
  category_hint?: Category;
  tier?: "daily" | "weekly";
  options?: Record<string, string>;
  /** A feed address believed correct; discovery verifies it before use. */
  feed_hint?: string;
  /**
   * A feed address set directly, without discovery: one checked by hand, or one for a host that
   * could not be reached to check it. The source starts as an rss source.
   */
  pinned_feed_url?: string;
  enabled?: boolean;
}

type Draft = Omit<Source, "failures" | "last_ok">;

const api = (
  partial: Omit<Draft, "enabled" | "options"> & {
    enabled?: boolean;
    options?: Record<string, string>;
  },
): Draft => ({
  enabled: true,
  options: {},
  ...partial,
});

/** GitHub repositories to watch for releases. Ids and names match config/sources.md where listed. */
export const GITHUB_SEED: readonly {
  id: string;
  name: string;
  repo: string;
  high_signal: boolean;
  category_hint: Category;
}[] = [
  {
    id: "shadcn-ui",
    name: "shadcn/ui",
    repo: "shadcn-ui/ui",
    high_signal: false,
    category_hint: "ui_component_primitives",
  },
  {
    id: "radix-ui",
    name: "Radix UI",
    repo: "radix-ui/primitives",
    high_signal: false,
    category_hint: "ui_component_primitives",
  },
  {
    id: "sonner",
    name: "Sonner",
    repo: "emilkowalski/sonner",
    high_signal: false,
    category_hint: "ui_component_primitives",
  },
  {
    id: "vaul",
    name: "Vaul",
    repo: "emilkowalski/vaul",
    high_signal: false,
    category_hint: "ui_component_primitives",
  },
  {
    id: "motion",
    name: "Motion",
    repo: "motiondivision/motion",
    high_signal: false,
    category_hint: "css_canvas_motion_techniques",
  },
  {
    id: "lenis",
    name: "Lenis",
    repo: "darkroomengineering/lenis",
    high_signal: false,
    category_hint: "css_canvas_motion_techniques",
  },
  {
    id: "assistant-ui",
    name: "assistant-ui",
    repo: "assistant-ui/assistant-ui",
    high_signal: false,
    category_hint: "ai_ux_interaction_patterns",
  },
  {
    id: "base-ui",
    name: "Base UI",
    repo: "mui/base-ui",
    high_signal: false,
    category_hint: "ui_component_primitives",
  },
  {
    id: "astro",
    name: "Astro",
    repo: "withastro/astro",
    high_signal: false,
    category_hint: "developer_tool_launches",
  },
];

/** YouTube channels from the reference list. Handles resolve to channel ids during discovery. */
export const YOUTUBE_SEED: readonly {
  id: string;
  name: string;
  handle: string;
  category_hint: Category;
}[] = [
  {
    id: "fireship",
    name: "Fireship",
    handle: "Fireship",
    category_hint: "developer_tool_launches",
  },
  {
    id: "kevin-powell",
    name: "Kevin Powell",
    handle: "KevinPowell",
    category_hint: "css_canvas_motion_techniques",
  },
  {
    id: "theo-t3gg",
    name: "Theo (t3.gg)",
    handle: "t3dotgg",
    category_hint: "developer_tool_launches",
  },
  {
    id: "hyperplexed",
    name: "Hyperplexed",
    handle: "Hyperplexed",
    category_hint: "css_canvas_motion_techniques",
  },
];

/**
 * Sources that are APIs rather than pages. Crossref ISSNs were checked against Crossref's journal
 * registry: TOCHI is 1073-0516 (print) and 1557-7325 (electronic); PACMHCI is 2573-0142.
 */
const REDDIT_OFF = "Off until a run shows Reddit lets a runner in (D240).";

export const API_SEED: readonly Draft[] = [
  api({
    id: "hn-show",
    name: "Hacker News: Show HN",
    type: "hn",
    url: "https://news.ycombinator.com/show",
    feed_url: "https://hn.algolia.com/api/v1/search_by_date",
    tier: "daily",
    high_signal: false,
    category_hint: "developer_tool_launches",
    options: { tags: "show_hn", min_points: "30" },
  }),
  api({
    id: "hn-ai",
    name: "Hacker News: AI",
    type: "hn",
    url: "https://news.ycombinator.com/news",
    feed_url: "https://hn.algolia.com/api/v1/search_by_date",
    tier: "daily",
    high_signal: false,
    category_hint: "frontier_model_releases",
    options: {
      tags: "story",
      min_points: "50",
      query: "LLM AI agents Claude GPT Gemini model",
    },
  }),
  api({
    id: "hn-design",
    name: "Hacker News: design",
    type: "hn",
    url: "https://news.ycombinator.com/best",
    feed_url: "https://hn.algolia.com/api/v1/search_by_date",
    tier: "daily",
    high_signal: false,
    category_hint: "ui_component_primitives",
    options: {
      tags: "story",
      min_points: "30",
      query: "design CSS UI UX typography animation Figma",
    },
  }),
  // Reddit threads: the community's own signal (D240). Off until a run shows Reddit lets a runner in.
  api({
    id: "reddit-localllama",
    name: "Reddit: r/LocalLLaMA",
    type: "reddit",
    url: "https://www.reddit.com/r/LocalLLaMA",
    feed_url: "https://www.reddit.com/r/LocalLLaMA/top.json?t=day&limit=100",
    tier: "daily",
    high_signal: false,
    category_hint: "frontier_model_releases",
    enabled: false,
    options: { note: REDDIT_OFF, subreddit: "LocalLLaMA", min_score: "50" },
  }),
  api({
    id: "reddit-claudeai",
    name: "Reddit: r/ClaudeAI",
    type: "reddit",
    url: "https://www.reddit.com/r/ClaudeAI",
    feed_url: "https://www.reddit.com/r/ClaudeAI/top.json?t=day&limit=100",
    tier: "daily",
    high_signal: false,
    category_hint: "frontier_model_releases",
    enabled: false,
    options: { note: REDDIT_OFF, subreddit: "ClaudeAI", min_score: "50" },
  }),
  api({
    id: "reddit-webdev",
    name: "Reddit: r/webdev",
    type: "reddit",
    url: "https://www.reddit.com/r/webdev",
    feed_url: "https://www.reddit.com/r/webdev/top.json?t=day&limit=100",
    tier: "daily",
    high_signal: false,
    category_hint: "software_engineering_depth",
    enabled: false,
    options: { note: REDDIT_OFF, subreddit: "webdev", min_score: "100" },
  }),
  api({
    id: "reddit-css",
    name: "Reddit: r/css",
    type: "reddit",
    url: "https://www.reddit.com/r/css",
    feed_url: "https://www.reddit.com/r/css/top.json?t=day&limit=100",
    tier: "daily",
    high_signal: false,
    category_hint: "css_canvas_motion_techniques",
    enabled: false,
    options: { note: REDDIT_OFF, subreddit: "css", min_score: "50" },
  }),
  api({
    id: "reddit-uxdesign",
    name: "Reddit: r/UXDesign",
    type: "reddit",
    url: "https://www.reddit.com/r/UXDesign",
    feed_url: "https://www.reddit.com/r/UXDesign/top.json?t=day&limit=100",
    tier: "daily",
    high_signal: false,
    category_hint: "design_engineering_craft",
    enabled: false,
    options: { note: REDDIT_OFF, subreddit: "UXDesign", min_score: "30" },
  }),
  api({
    id: "reddit-web-design",
    name: "Reddit: r/web_design",
    type: "reddit",
    url: "https://www.reddit.com/r/web_design",
    feed_url: "https://www.reddit.com/r/web_design/top.json?t=day&limit=100",
    tier: "daily",
    high_signal: false,
    category_hint: "design_engineering_craft",
    enabled: false,
    options: { note: REDDIT_OFF, subreddit: "web_design", min_score: "30" },
  }),
  api({
    id: "arxiv-cs-hc",
    name: "arXiv cs.HC",
    type: "arxiv",
    url: "https://arxiv.org/list/cs.HC/recent",
    feed_url:
      "https://export.arxiv.org/api/query?search_query=cat%3Acs.HC&sortBy=submittedDate&sortOrder=descending&max_results=100",
    tier: "daily",
    high_signal: false,
    category_hint: "hci_empirical_research",
    options: { category: "cs.HC", max_results: "100" },
  }),
  api({
    id: "acm-tochi",
    name: "ACM TOCHI",
    type: "crossref",
    url: "https://dl.acm.org/journal/tochi",
    feed_url: "https://api.crossref.org/journals/1073-0516/works",
    tier: "weekly",
    high_signal: false,
    category_hint: "hci_empirical_research",
    options: { issn: "1073-0516" },
  }),
  api({
    id: "acm-pacmhci",
    name: "ACM PACMHCI",
    type: "crossref",
    url: "https://dl.acm.org/journal/pacmhci",
    feed_url: "https://api.crossref.org/journals/2573-0142/works",
    tier: "weekly",
    high_signal: false,
    category_hint: "hci_empirical_research",
    options: { issn: "2573-0142" },
  }),
  api({
    id: "product-hunt",
    name: "Product Hunt",
    type: "producthunt",
    url: "https://www.producthunt.com",
    feed_url: "https://www.producthunt.com/feed",
    tier: "daily",
    high_signal: false,
    category_hint: "developer_tool_launches",
  }),
  api({
    id: "lobsters",
    name: "Lobsters",
    type: "lobsters",
    url: "https://lobste.rs",
    feed_url: "https://lobste.rs/hottest.json",
    tier: "daily",
    high_signal: false,
    category_hint: "developer_tool_launches",
  }),
  api({
    id: "exa-discovery",
    name: "Exa discovery",
    type: "exa",
    url: "https://exa.ai",
    feed_url: "https://api.exa.ai/search",
    tier: "daily",
    high_signal: false,
    options: { queries: "config/queries.json", pool_cap: "25" },
  }),
];

const feed = (id: string, name: string, url: string, feedUrl: string, topicId: "design"): Draft =>
  api({
    id,
    name,
    type: "rss",
    url,
    feed_url: feedUrl,
    tier: "daily",
    high_signal: false,
    origin: "seed",
    topic_ids: [topicId],
    options: { pool_cap: "6" },
  });

/**
 * An outlet's top stories, which fed Trending (D40) until Trending was switched off (D69). Filed
 * under World, read like a general feed (no pool cap, every story judged). Where the outlet already
 * has a World desk among the general feeds, the top stories would add its home news and copies of
 * that desk, so the feed starts off and the owner can tick it on.
 */
const topStories = (
  id: string,
  name: string,
  url: string,
  feedUrl: string,
  enabled: boolean,
): Draft => ({
  ...api({
    id,
    name,
    type: "rss",
    url,
    feed_url: feedUrl,
    tier: "daily",
    high_signal: false,
    origin: "seed",
    topic_ids: ["world"],
    ...(enabled
      ? {}
      : { options: { note: "the outlet's top stories; its World desk already feeds World" } }),
  }),
  enabled,
});

/**
 * Feeds that ship with the app for Design (D39) and the old Trending outlets (D40, D69). Feeds
 * only, each checked on 2026-10-08, none of them needing Firecrawl. A source tagged for a topic is
 * judged for that topic.
 *
 * Design takes five feeds chosen for UI, UX and product design, leaving out the architecture,
 * furniture and concept-render feeds. The seven outlets that made Trending now feed World.
 */
export const APP_TOPIC_SOURCES: readonly Draft[] = [
  feed(
    "nielsen-norman-group",
    "Nielsen Norman Group",
    "https://www.nngroup.com",
    "https://www.nngroup.com/feed/rss/",
    "design",
  ),
  feed(
    "ux-collective",
    "UX Collective",
    "https://uxdesign.cc",
    "https://uxdesign.cc/feed",
    "design",
  ),
  feed(
    "creative-bloq",
    "Creative Bloq",
    "https://www.creativebloq.com",
    "https://www.creativebloq.com/feeds.xml",
    "design",
  ),
  feed(
    "design-observer",
    "Design Observer",
    "https://designobserver.com",
    "https://designobserver.com/feed/",
    "design",
  ),
  feed(
    "creative-boom",
    "Creative Boom",
    "https://www.creativeboom.com",
    "https://www.creativeboom.com/feed/",
    "design",
  ),
  topStories(
    "npr-news",
    "NPR News",
    "https://www.npr.org",
    "https://feeds.npr.org/1001/rss.xml",
    false,
  ),
  topStories(
    "cbs-news",
    "CBS News",
    "https://www.cbsnews.com",
    "https://www.cbsnews.com/latest/rss/main",
    false,
  ),
  topStories(
    "abc-news",
    "ABC News",
    "https://abcnews.com",
    "https://abcnews.com/abcnews/topstories",
    false,
  ),
  topStories(
    "al-jazeera",
    "Al Jazeera",
    "https://www.aljazeera.com",
    "https://www.aljazeera.com/xml/rss/all.xml",
    false,
  ),
  topStories(
    "france-24",
    "France 24",
    "https://www.france24.com",
    "https://www.france24.com/en/rss",
    true,
  ),
  topStories(
    "sky-news",
    "Sky News",
    "https://news.sky.com",
    "https://feeds.skynews.com/feeds/rss/home.xml",
    false,
  ),
  topStories(
    "pbs-newshour",
    "PBS NewsHour",
    "https://www.pbs.org/newshour/",
    "https://www.pbs.org/newshour/feeds/rss/headlines",
    false,
  ),
];

/** A general topic's id, or the technology desk, which is filed under the owner's Tech beat. */
type GeneralDesk = GeneralTopicId | "technology";

const DESK_TITLES: Record<GeneralDesk, string> = {
  world: "World",
  business: "Business",
  science: "Science",
  culture: "Culture",
  sports: "Sports",
  technology: "Technology",
};

/**
 * One category feed of a general news outlet. The id joins the outlet and the desk (`npr-world`,
 * `npr-business`), because the same outlet feeds several topics. The page address is the desk's
 * own page, so two desks of one outlet are not mistaken for one page; the outlet is told apart
 * from the page's host. No pool cap: every story of a general feed is judged (D66).
 *
 * A story of a topic the owner switched off is never fetched. The technology desks are not a
 * general topic: they are filed under the built-in consumer tech topic, whose home section is
 * Tech, and start switched off so the owner can tick them on.
 */
const generalFeed = (
  outlet: string,
  outletName: string,
  desk: GeneralDesk,
  url: string,
  feedUrl: string,
): Draft => {
  const tech = desk === "technology";
  const draft = api({
    id: `${outlet}-${desk}`,
    name: `${outletName} ${DESK_TITLES[desk]}`,
    type: "rss",
    url,
    feed_url: feedUrl,
    tier: "daily",
    high_signal: false,
    origin: "seed",
    topic_ids: [tech ? TECH_CATEGORY : desk],
    ...(tech
      ? {
          category_hint: TECH_CATEGORY,
          options: {
            pool_cap: "6",
            note: "switched off until ticked on; then it feeds the Tech section like any tech outlet",
          },
        }
      : {}),
  });
  return tech ? { ...draft, enabled: false } : draft;
};

/**
 * The open category feeds behind the five general news topics (D66), which a separate feed list
 * held before they became sources. Each is judged in full on every run, so it earns a score like
 * any source, and is read by general episodes. Feeds only, none needing a key or Firecrawl. D69
 * added desks from outlets already here (CBS, Sky, PBS, BBC) and The Guardian, so each topic
 * has five or more outlets: a general episode ranks a story by how many outlets carried it.
 */
export const GENERAL_TOPIC_SOURCES: readonly Draft[] = [
  generalFeed(
    "npr",
    "NPR",
    "world",
    "https://www.npr.org/sections/world/",
    "https://feeds.npr.org/1004/rss.xml",
  ),
  generalFeed(
    "abc-news",
    "ABC News",
    "world",
    "https://abcnews.com/International",
    "https://abcnews.com/abcnews/internationalheadlines",
  ),
  generalFeed(
    "al-jazeera",
    "Al Jazeera",
    "world",
    "https://www.aljazeera.com/news/",
    "https://www.aljazeera.com/xml/rss/all.xml",
  ),
  generalFeed(
    "bbc",
    "BBC",
    "world",
    "https://www.bbc.com/news/world",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
  ),
  generalFeed(
    "cbs-news",
    "CBS News",
    "world",
    "https://www.cbsnews.com/world/",
    "https://www.cbsnews.com/latest/rss/world",
  ),
  generalFeed(
    "sky-news",
    "Sky News",
    "world",
    "https://news.sky.com/world",
    "https://feeds.skynews.com/feeds/rss/world.xml",
  ),
  generalFeed(
    "pbs-newshour",
    "PBS NewsHour",
    "world",
    "https://www.pbs.org/newshour/world",
    "https://www.pbs.org/newshour/feeds/rss/world",
  ),
  generalFeed(
    "guardian",
    "The Guardian",
    "world",
    "https://www.theguardian.com/world",
    "https://www.theguardian.com/world/rss",
  ),
  generalFeed(
    "npr",
    "NPR",
    "business",
    "https://www.npr.org/sections/business/",
    "https://feeds.npr.org/1006/rss.xml",
  ),
  generalFeed(
    "cbs-news",
    "CBS News",
    "business",
    "https://www.cbsnews.com/moneywatch/",
    "https://www.cbsnews.com/latest/rss/moneywatch",
  ),
  generalFeed(
    "abc-news",
    "ABC News",
    "business",
    "https://abcnews.com/Business",
    "https://abcnews.com/abcnews/moneyheadlines",
  ),
  generalFeed(
    "sky-news",
    "Sky News",
    "business",
    "https://news.sky.com/business",
    "https://feeds.skynews.com/feeds/rss/business.xml",
  ),
  generalFeed(
    "bbc",
    "BBC",
    "business",
    "https://www.bbc.com/news/business",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
  ),
  generalFeed(
    "guardian",
    "The Guardian",
    "business",
    "https://www.theguardian.com/business",
    "https://www.theguardian.com/business/rss",
  ),
  generalFeed(
    "npr",
    "NPR",
    "science",
    "https://www.npr.org/sections/science/",
    "https://feeds.npr.org/1007/rss.xml",
  ),
  generalFeed(
    "pbs-newshour",
    "PBS NewsHour",
    "science",
    "https://www.pbs.org/newshour/science",
    "https://www.pbs.org/newshour/feeds/rss/science",
  ),
  generalFeed(
    "sciencedaily",
    "ScienceDaily",
    "science",
    "https://www.sciencedaily.com",
    "https://www.sciencedaily.com/rss/top/science.xml",
  ),
  generalFeed(
    "guardian",
    "The Guardian",
    "science",
    "https://www.theguardian.com/science",
    "https://www.theguardian.com/science/rss",
  ),
  generalFeed(
    "bbc",
    "BBC",
    "science",
    "https://www.bbc.com/news/science_and_environment",
    "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
  ),
  generalFeed(
    "npr",
    "NPR",
    "culture",
    "https://www.npr.org/sections/arts/",
    "https://feeds.npr.org/1008/rss.xml",
  ),
  generalFeed(
    "pbs-newshour",
    "PBS NewsHour",
    "culture",
    "https://www.pbs.org/newshour/arts",
    "https://www.pbs.org/newshour/feeds/rss/arts",
  ),
  generalFeed(
    "abc-news",
    "ABC News",
    "culture",
    "https://abcnews.com/Entertainment",
    "https://abcnews.com/abcnews/entertainmentheadlines",
  ),
  generalFeed(
    "bbc",
    "BBC",
    "culture",
    "https://www.bbc.com/news/entertainment_and_arts",
    "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  ),
  generalFeed(
    "guardian",
    "The Guardian",
    "culture",
    "https://www.theguardian.com/culture",
    "https://www.theguardian.com/culture/rss",
  ),
  generalFeed(
    "cbs-news",
    "CBS News",
    "culture",
    "https://www.cbsnews.com/entertainment/",
    "https://www.cbsnews.com/latest/rss/entertainment",
  ),
  generalFeed(
    "npr",
    "NPR",
    "sports",
    "https://www.npr.org/sections/sports/",
    "https://feeds.npr.org/1055/rss.xml",
  ),
  generalFeed(
    "abc-news",
    "ABC News",
    "sports",
    "https://abcnews.com/Sports",
    "https://abcnews.com/abcnews/sportsheadlines",
  ),
  generalFeed(
    "espn",
    "ESPN",
    "sports",
    "https://www.espn.com",
    "https://www.espn.com/espn/rss/news",
  ),
  generalFeed(
    "bbc",
    "BBC",
    "sports",
    "https://www.bbc.com/sport",
    "https://feeds.bbci.co.uk/sport/rss.xml",
  ),
  generalFeed(
    "guardian",
    "The Guardian",
    "sports",
    "https://www.theguardian.com/sport",
    "https://www.theguardian.com/sport/rss",
  ),
  generalFeed(
    "npr",
    "NPR",
    "technology",
    "https://www.npr.org/sections/technology/",
    "https://feeds.npr.org/1019/rss.xml",
  ),
  generalFeed(
    "cbs-news",
    "CBS News",
    "technology",
    "https://www.cbsnews.com/technology/",
    "https://www.cbsnews.com/latest/rss/technology",
  ),
  generalFeed(
    "abc-news",
    "ABC News",
    "technology",
    "https://abcnews.com/Technology",
    "https://abcnews.com/abcnews/technologyheadlines",
  ),
  generalFeed(
    "sky-news",
    "Sky News",
    "technology",
    "https://news.sky.com/technology",
    "https://feeds.skynews.com/feeds/rss/technology.xml",
  ),
];

/**
 * Hosts whose rows in sources.md are covered by the API seed above, so the table rows are skipped.
 * dl.acm.org's RSS endpoint is superseded by Crossref, which needs no browser headers.
 */
export const SEEDED_HOSTS: ReadonlySet<string> = new Set([
  "hn.algolia.com",
  "news.ycombinator.com",
  "lobste.rs",
  "www.producthunt.com",
  "arxiv.org",
  "dl.acm.org",
]);

const IND = "design_engineering_craft" as const;
const CSS = "css_canvas_motion_techniques" as const;
const UI = "ui_component_primitives" as const;
const DEV = "developer_tool_launches" as const;
const FRONTIER = "frontier_model_releases" as const;
const AIUX = "ai_ux_interaction_patterns" as const;
const TASTE = "taste_and_design_philosophy" as const;
const TECH = "consumer_tech_releases" as const;
const DEPTH = "software_engineering_depth" as const;

/**
 * A consumer tech outlet: hinted for the Tech releases section, six candidates a run so no one
 * outlet fills the tech pool, and a feed address that answered with RSS when it was checked by
 * hand on 2026-10-07.
 */
const techOutlet = (feed: string): Curation => ({
  category_hint: TECH,
  pinned_feed_url: feed,
  options: { pool_cap: "6" },
});

/**
 * A daily AI roundup. Filed under AI (D69) but off until the owner ticks it on: they were muted by
 * the hype hint before, and switched on with the AI hint they would bring a day's hype into the
 * pool. The score shows whether one has earned a place.
 */
const hypeRoundup: Curation = {
  category_hint: FRONTIER,
  enabled: false,
  options: { note: "a daily AI roundup, much of it hype; off until ticked on" },
};

/** Source-by-source decisions, keyed by id. Anything not listed gets the importer's defaults. */
export const CURATIONS: Readonly<Record<string, Curation>> = {
  // Labs and engineering blogs
  "openai-blog": { high_signal: true, category_hint: FRONTIER },
  "anthropic-blog": { high_signal: true, category_hint: FRONTIER },
  "deepmind-blog": { high_signal: true, category_hint: FRONTIER },
  "cloudflare-blog": { category_hint: DEPTH, feed_hint: "https://blog.cloudflare.com/rss/" },
  "vercel-blog": { category_hint: DEV },
  "linear-blog": { high_signal: true, category_hint: IND },
  "stripe-engineering": { category_hint: DEPTH },
  "github-engineering": { category_hint: DEPTH },
  "meta-ai-blog": { category_hint: FRONTIER },
  "mistral-blog": { category_hint: FRONTIER },
  "hugging-face-blog": { category_hint: FRONTIER },
  "stability-ai-blog": { category_hint: FRONTIER },
  "cohere-blog": { category_hint: FRONTIER },
  "xai-blog": { category_hint: FRONTIER },
  // AI newsletters
  "import-ai": { high_signal: true, category_hint: FRONTIER },
  "the-batch": { category_hint: FRONTIER },
  "the-rundown-ai": hypeRoundup,
  "tldr-ai": { category_hint: FRONTIER, feed_hint: "https://tldr.tech/api/rss/ai" },
  "ahead-of-ai": { category_hint: FRONTIER },
  "last-week-in-ai": {
    category_hint: FRONTIER,
    pinned_feed_url: "https://lastweekin.ai/feed",
    options: { note: "feed not verified: lastweekin.ai did not resolve on 2026-10-06" },
  },
  "the-algorithm": { category_hint: FRONTIER },
  "one-useful-thing": { category_hint: AIUX },
  "superhuman-ai": hypeRoundup,
  "the-neuron": hypeRoundup,
  "simon-willison": {
    high_signal: true,
    category_hint: AIUX,
    feed_hint: "https://simonwillison.net/atom/everything/",
  },
  "aux-first": { category_hint: AIUX },
  "beyond-the-screen": { category_hint: AIUX },
  "latent-space": { category_hint: FRONTIER, pinned_feed_url: "https://www.latent.space/feed" },
  "the-decoder": { category_hint: FRONTIER, pinned_feed_url: "https://the-decoder.com/feed/" },
  "google-ai-blog": {
    category_hint: FRONTIER,
    pinned_feed_url: "https://blog.google/innovation-and-ai/technology/ai/rss/",
  },
  // Individual craft blogs
  "rauno-freiberg": { high_signal: true, category_hint: IND },
  "emil-kowalski": { high_signal: true, category_hint: CSS },
  "josh-w-comeau": {
    high_signal: true,
    category_hint: CSS,
    feed_hint: "https://www.joshwcomeau.com/rss.xml",
  },
  "jhey-tompkins": { high_signal: true, category_hint: CSS },
  "andy-bell": { high_signal: true, category_hint: IND },
  "paco-coursey": { high_signal: true, category_hint: IND },
  "lee-robinson": { high_signal: true, category_hint: DEPTH },
  "dan-abramov": { high_signal: true, category_hint: DEPTH },
  "kent-c-dodds": { high_signal: true, category_hint: DEPTH },
  "adam-wathan": { high_signal: true, category_hint: IND },
  "ryan-florence": {
    high_signal: true,
    category_hint: UI,
    enabled: false,
    options: { note: "ryanflorence.com redirects to remix.run; covered by remix-blog" },
  },
  "darkroom-engineering": { high_signal: true, category_hint: CSS },
  codrops: { category_hint: CSS },
  "css-tricks": { category_hint: CSS },
  "bram-us": { category_hint: CSS, pinned_feed_url: "https://www.bram.us/feed/" },
  piccalilli: {
    high_signal: true,
    category_hint: IND,
    pinned_feed_url: "https://piccalil.li/feed.xml",
  },
  "ahmad-shadeed": {
    high_signal: true,
    category_hint: CSS,
    pinned_feed_url: "https://ishadeed.com/feed.xml",
  },
  "brad-frost": {
    high_signal: true,
    category_hint: UI,
    pinned_feed_url: "https://bradfrost.com/feed/feed.xml",
  },
  "dave-rupert": { category_hint: IND, pinned_feed_url: "https://daverupert.com/atom.xml" },
  adactio: { category_hint: TASTE, pinned_feed_url: "https://adactio.com/rss/" },
  webkit: { category_hint: CSS, pinned_feed_url: "https://webkit.org/feed/" },
  // Design engineering newsletters
  // Friday Checkout is a weekly consumer tech roundup, not a design newsletter.
  "friday-checkout": { category_hint: TECH },
  "toools-newsletter": { category_hint: AIUX },
  "ui-things": { category_hint: UI },
  "frontend-focus": { category_hint: CSS },
  "css-weekly": { category_hint: CSS },
  "smashing-magazine": { category_hint: IND },
  "sidebar-io": { category_hint: TASTE },
  heydesigner: { category_hint: IND },
  // JavaScript and web dev
  "javascript-weekly": {
    category_hint: DEV,
    feed_hint: "https://javascriptweekly.com/rss/",
    options: { kind: "newsletter-issue" },
  },
  "react-status": {
    category_hint: DEV,
    feed_hint: "https://react.statuscode.com/rss/",
    options: { kind: "newsletter-issue" },
  },
  "node-weekly": {
    category_hint: DEV,
    feed_hint: "https://nodeweekly.com/rss/",
    options: { kind: "newsletter-issue" },
  },
  "deno-weekly": {
    category_hint: DEV,
    enabled: false,
    options: { note: "discontinued in May 2022; Deno news is covered by deno-blog" },
  },
  "typescript-weekly": { category_hint: DEV, options: { kind: "newsletter-issue" } },
  tldr: { category_hint: DEV, feed_hint: "https://tldr.tech/api/rss/tech" },
  bytes: { category_hint: DEV },
  "console-dev": { category_hint: DEV },
  "this-week-in-react": { category_hint: DEV },
  "better-stack-blog": { category_hint: DEV },
  // UI library repos and changelogs
  "shadcn-changelog": { high_signal: false, category_hint: UI },
  "headless-ui": { category_hint: UI },
  "ark-ui": { category_hint: UI },
  "melt-ui": { category_hint: UI },
  "react-aria": { category_hint: UI },
  "figma-release-notes": { category_hint: IND },
  "storybook-blog": { category_hint: UI },
  "tailwind-css-blog": { category_hint: DEV },
  "material-design-blog": { category_hint: IND },
  // Aggregators and journalism. Brutalist Report and TechCrunch feed Technology (D69); the judge
  // still files a funding story under the never-publish topic, whatever the hint.
  "brutalist-report": {
    category_hint: TECH,
    options: { kind: "newsletter-link", pool_cap: "6" },
  },
  techcrunch: { category_hint: TECH, options: { pool_cap: "6" } },
  techmeme: techOutlet("https://www.techmeme.com/feed.xml"),
  // Off: an account-only feed (import.ts). Filed with the developer news it would bring.
  "daily-dev": { category_hint: DEV },
  "the-verge": { category_hint: TECH },
  "ars-technica": { category_hint: TECH },
  // Consumer tech outlets
  "9to5google": techOutlet("https://9to5google.com/feed/"),
  "9to5mac": techOutlet("https://9to5mac.com/feed/"),
  "android-authority": techOutlet("https://www.androidauthority.com/feed/"),
  gsmarena: techOutlet("https://www.gsmarena.com/rss-news-reviews.php3"),
  engadget: techOutlet("https://www.engadget.com/rss.xml"),
  electrek: techOutlet("https://electrek.co/feed/"),
  "toms-hardware": techOutlet("https://www.tomshardware.com/feeds.xml"),
  // Framework blogs from the Firecrawl watch list
  "nextjs-blog": { category_hint: DEV, feed_hint: "https://nextjs.org/feed.xml" },
  "vite-blog": { category_hint: DEV },
  "astro-blog": { category_hint: DEV },
  "svelte-blog": { category_hint: DEV },
  "nuxt-blog": { category_hint: DEV },
  "bun-blog": { category_hint: DEV },
  "deno-blog": { category_hint: DEV },
  "remix-blog": { category_hint: DEV },
};

/** Display names where the table name, minus any parenthetical, reads awkwardly as a label. */
export const NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "deepmind-blog": "Google DeepMind",
  "linear-blog": "Linear",
  "simon-willison": "Simon Willison",
  "shadcn-changelog": "shadcn/ui changelog",
};

/** Ids where the slug of the table name is not the id we want. */
export const ID_OVERRIDES: Readonly<Record<string, string>> = {
  "google-deepmind-antigravity": "deepmind-blog",
  "linear-method-blog": "linear-blog",
  "simon-willison-s-weblog": "simon-willison",
  "shadcn-ui": "shadcn-changelog",
  "tom-s-hardware": "toms-hardware",
};
