import type { Category, Source } from "@dispatch/core";

/** What the importer decides about a source beyond its name and URL. Keyed by source id. */
export interface Curation {
  high_signal?: boolean;
  category_hint?: Category;
  tier?: "daily" | "weekly";
  options?: Record<string, string>;
  /** A feed address believed correct; discovery verifies it before use. */
  feed_hint?: string;
  /** A feed address set without verification, for a host that could not be reached to check it. */
  pinned_feed_url?: string;
  enabled?: boolean;
}

type Draft = Omit<Source, "failures" | "last_ok">;

const api = (
  partial: Omit<Draft, "enabled" | "options"> & { options?: Record<string, string> },
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
    high_signal: true,
    category_hint: "ui_component_primitives",
  },
  {
    id: "radix-ui",
    name: "Radix UI",
    repo: "radix-ui/primitives",
    high_signal: true,
    category_hint: "ui_component_primitives",
  },
  {
    id: "sonner",
    name: "Sonner",
    repo: "emilkowalski/sonner",
    high_signal: true,
    category_hint: "ui_component_primitives",
  },
  {
    id: "vaul",
    name: "Vaul",
    repo: "emilkowalski/vaul",
    high_signal: true,
    category_hint: "ui_component_primitives",
  },
  {
    id: "motion",
    name: "Motion",
    repo: "motiondivision/motion",
    high_signal: true,
    category_hint: "css_canvas_motion_techniques",
  },
  {
    id: "lenis",
    name: "Lenis",
    repo: "darkroomengineering/lenis",
    high_signal: true,
    category_hint: "css_canvas_motion_techniques",
  },
  {
    id: "assistant-ui",
    name: "assistant-ui",
    repo: "assistant-ui/assistant-ui",
    high_signal: true,
    category_hint: "ai_ux_interaction_patterns",
  },
  {
    id: "base-ui",
    name: "Base UI",
    repo: "mui/base-ui",
    high_signal: true,
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

/** Source-by-source decisions, keyed by id. Anything not listed gets the importer's defaults. */
export const CURATIONS: Readonly<Record<string, Curation>> = {
  // Labs and engineering blogs
  "openai-blog": { high_signal: true, category_hint: FRONTIER },
  "anthropic-blog": { high_signal: true, category_hint: FRONTIER },
  "deepmind-blog": { high_signal: true, category_hint: FRONTIER },
  "cloudflare-blog": { category_hint: DEV, feed_hint: "https://blog.cloudflare.com/rss/" },
  "vercel-blog": { category_hint: DEV },
  "linear-blog": { high_signal: true, category_hint: IND },
  "stripe-engineering": { category_hint: DEV },
  "github-engineering": { category_hint: DEV },
  "meta-ai-blog": { category_hint: FRONTIER },
  "mistral-blog": { category_hint: FRONTIER },
  "hugging-face-blog": { category_hint: FRONTIER },
  "stability-ai-blog": { category_hint: FRONTIER },
  "cohere-blog": { category_hint: FRONTIER },
  "xai-blog": { category_hint: FRONTIER },
  // AI newsletters
  "import-ai": { high_signal: true, category_hint: FRONTIER },
  "the-batch": { category_hint: FRONTIER },
  "the-rundown-ai": { category_hint: "generic_ai_hype_listicles" },
  "tldr-ai": { category_hint: FRONTIER, feed_hint: "https://tldr.tech/api/rss/ai" },
  "ahead-of-ai": { category_hint: FRONTIER },
  "last-week-in-ai": {
    category_hint: FRONTIER,
    pinned_feed_url: "https://lastweekin.ai/feed",
    options: { note: "feed not verified: lastweekin.ai did not resolve on 2026-10-06" },
  },
  "the-algorithm": { category_hint: FRONTIER },
  "one-useful-thing": { category_hint: AIUX },
  "superhuman-ai": { category_hint: "generic_ai_hype_listicles" },
  "the-neuron": { category_hint: "generic_ai_hype_listicles" },
  "simon-willison": {
    high_signal: true,
    category_hint: AIUX,
    feed_hint: "https://simonwillison.net/atom/everything/",
  },
  "aux-first": { category_hint: AIUX },
  "beyond-the-screen": { category_hint: AIUX },
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
  "lee-robinson": { high_signal: true, category_hint: IND },
  "dan-abramov": { high_signal: true, category_hint: IND },
  "kent-c-dodds": { high_signal: true, category_hint: IND },
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
  // Design engineering newsletters
  "friday-checkout": { category_hint: IND },
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
    category_hint: UI,
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
  "this-week-in-react": { category_hint: UI },
  "better-stack-blog": { category_hint: DEV },
  // UI library repos and changelogs
  "shadcn-changelog": { high_signal: true, category_hint: UI },
  "headless-ui": { category_hint: UI },
  "ark-ui": { category_hint: UI },
  "melt-ui": { category_hint: UI },
  "react-aria": { category_hint: UI },
  "figma-release-notes": { category_hint: IND },
  "storybook-blog": { category_hint: UI },
  "tailwind-css-blog": { category_hint: DEV },
  "material-design-blog": { category_hint: IND },
  // Aggregators and journalism
  "brutalist-report": { options: { kind: "newsletter-link" } },
  techcrunch: { category_hint: "venture_capital_and_gossip" },
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
};
