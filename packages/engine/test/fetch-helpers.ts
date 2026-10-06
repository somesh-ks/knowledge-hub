import { readFileSync } from "node:fs";
import { type Item, itemId, type JudgmentEntry, type Source } from "@dispatch/core";
import type { FetchDeps } from "../src/fetch/types.js";
import type { FetchWindow } from "../src/gate/fetchWindow.js";
import { createHttpClient, type FetchImpl } from "../src/http.js";
import { canonicalizeUrl } from "../src/normalize/canonicalizeUrl.js";

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export const NOW = new Date("2026-10-06T06:00:00Z");

/** Covers every fixture date from July to the morning of 6 October 2026. */
export const WIDE: FetchWindow = {
  from: new Date("2026-07-01T00:00:00Z"),
  to: NOW,
};

/** A typical regular window: two days. */
export const TWO_DAYS: FetchWindow = {
  from: new Date("2026-10-04T06:00:00Z"),
  to: NOW,
};

/** Every category plus "none", as the judgment schema requires. */
export const CATEGORY_PROBS: JudgmentEntry["category_probs"] = {
  design_engineering_craft: 0.7,
  hci_empirical_research: 0,
  ui_component_primitives: 0,
  ai_ux_interaction_patterns: 0,
  css_canvas_motion_techniques: 0,
  frontier_model_releases: 0,
  developer_tool_launches: 0,
  taste_and_design_philosophy: 0,
  venture_capital_and_gossip: 0,
  generic_ai_hype_listicles: 0,
  none: 0.3,
};

export function makeSource(overrides: Partial<Source> & { id: string }): Source {
  return {
    name: overrides.id,
    type: "rss",
    url: "https://example.com",
    feed_url: "https://example.com/feed.xml",
    tier: "daily",
    high_signal: false,
    enabled: true,
    failures: 0,
    options: {},
    ...overrides,
  };
}

export function makeItem(
  overrides: Partial<Item> & { url: string; title: string; source_id?: string },
): Item {
  const canonical = canonicalizeUrl(overrides.url) ?? overrides.url;
  return {
    id: itemId(canonical),
    canonical_url: canonical,
    source_id: "src-a",
    source_type: "rss",
    fetched_at: "2026-10-06T06:00:00.000Z",
    published_at: "2026-10-05T12:00:00.000Z",
    snippet: "",
    signals: {},
    ...overrides,
  };
}

export type Route =
  | string
  | { status?: number; body?: string; headers?: Record<string, string> }
  | ((url: string, init?: RequestInit) => Response | Promise<Response>);

export interface FakeFetch extends FetchImpl {
  calls: string[];
}

/**
 * A fetch that serves canned responses by exact URL, then by longest prefix. Unknown URLs get
 * 404, so a test that wanders to the network by mistake fails loudly instead of hanging.
 */
export function fakeFetch(routes: Record<string, Route>): FakeFetch {
  const calls: string[] = [];
  const impl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push(input);
    const key =
      input in routes
        ? input
        : Object.keys(routes)
            .filter((prefix) => input.startsWith(prefix))
            .sort((a, b) => b.length - a.length)[0];
    const route = key === undefined ? undefined : routes[key];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "function") return route(input, init);
    if (typeof route === "string") return new Response(route, { status: 200 });
    return new Response(route.body ?? "", { status: route.status ?? 200, headers: route.headers });
  };
  return Object.assign(impl, { calls });
}

/** Deps for a fetcher: fake network, no real sleeping, fixed clock. */
export function makeDeps(fetchImpl: FetchImpl, extra: Partial<FetchDeps> = {}): FetchDeps {
  return {
    http: createHttpClient({ fetchImpl, sleep: async () => {}, random: () => 0 }),
    now: () => NOW,
    ...extra,
  };
}
