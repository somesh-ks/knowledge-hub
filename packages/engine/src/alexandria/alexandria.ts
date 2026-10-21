import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Item } from "@dispatch/core";
import { z } from "zod";
import { FEED_TEXT_ENOUGH_CHARS } from "../extract/extractText.js";
import type { FirecrawlGuard } from "../fetch/firecrawlBudget.js";
import { contentTokens } from "../validate/excerpt.js";

const FIRECRAWL_BASE = "https://api.firecrawl.dev";

/** `config/alexandria.json`. Every field has a default, so the file may be absent or partial. */
export const AlexandriaConfig = z.object({
  /** Off switch; the feature is also off without a Firecrawl key. */
  enabled: z.boolean().default(true),
  /** Credits one run may spend on Alexandria, across all stories. */
  run_credit_cap: z.number().int().nonnegative().default(30),
  /** Credits one story may spend; a capability whose price is above it is not called. */
  story_credit_cap: z.number().int().nonnegative().default(10),
  /** Milliseconds one story may wait for discovery and execution together. */
  timeout_ms: z.number().int().positive().default(20_000),
  /** Records kept from one answer. */
  max_records: z.number().int().positive().default(5),
  /** Characters of facts passed to the writer. */
  max_chars: z.number().int().positive().default(1_500),
});
export type AlexandriaConfig = z.infer<typeof AlexandriaConfig>;

export const ALEXANDRIA_CONFIG_FILE = "config/alexandria.json";

export async function loadAlexandriaConfig(root: string): Promise<AlexandriaConfig> {
  try {
    const raw = await readFile(join(root, ALEXANDRIA_CONFIG_FILE), "utf8");
    const parsed = AlexandriaConfig.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Missing or unreadable: the defaults apply.
  }
  return AlexandriaConfig.parse({});
}

/** Text this short, after the feed, the free page read and the Firecrawl scrape, is thin. */
export function isThinText(text: string | null | undefined): boolean {
  return !text || text.trim().length < FEED_TEXT_ENOUGH_CHARS;
}

export interface AlexandriaOptions {
  apiKey: string;
  config: AlexandriaConfig;
  fetchImpl?: typeof fetch;
  /** Called once per executed capability with the credits it cost. `estimated` when the reply did not say. */
  onCredits?: (credits: number, estimated: boolean) => void;
  /** The run's Firecrawl guard, so Alexandria stops when Firecrawl is rate limited. */
  guard?: FirecrawlGuard | undefined;
}

export interface Alexandria {
  /**
   * Sourced facts about the story's subject as a labelled block of text, or null when nothing
   * usable came back, the caps are reached or anything failed. Never throws.
   */
  factsFor(item: Pick<Item, "title">): Promise<string | null>;
  /** Credits spent or reserved so far. */
  readonly spent: number;
}

interface Tool {
  provider: string;
  capability: string;
  description: string;
  options: Array<{ name: string; type?: string; required?: boolean; max?: number }>;
  responseKey: string | undefined;
}

const TEXT_OPTIONS = new Set([
  "q",
  "query",
  "search",
  "name",
  "keyword",
  "keywords",
  "q_organization_name",
  "company",
  "company_name",
]);

/** Credits a capability says it costs ("Each requested page costs 30 Firecrawl credits"), or null. */
export function statedCredits(description: string): number | null {
  const match = /(\d+)\s+(?:Firecrawl\s+)?credits?\b/i.exec(description);
  return match ? Number(match[1]) : null;
}

function parseTools(json: unknown): Tool[] {
  const tools = (json as { data?: { tools?: unknown } } | null)?.data?.tools;
  if (!Array.isArray(tools)) return [];
  const out: Tool[] = [];
  for (const raw of tools) {
    const t = raw as Record<string, unknown>;
    if (typeof t.provider !== "string" || typeof t.capability !== "string") continue;
    const options = Array.isArray(t.options) ? (t.options as Tool["options"]) : [];
    const response = t.response as { key?: unknown } | undefined;
    out.push({
      provider: t.provider,
      capability: t.capability,
      description: typeof t.description === "string" ? t.description : "",
      options,
      responseKey: typeof response?.key === "string" ? response.key : undefined,
    });
  }
  return out;
}

/** The request options for a tool when one free-text input is all it needs; null when it needs more. */
function optionsFor(tool: Tool, query: string, records: number): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let queried = false;
  for (const option of tool.options) {
    if (TEXT_OPTIONS.has(option.name) && option.type === "string") {
      out[option.name] = query;
      queried = true;
    } else if (option.required) {
      return null;
    } else if (option.name === "limit" || option.name === "per_page") {
      out[option.name] = Math.min(records, option.max ?? records);
    }
  }
  return queried ? out : null;
}

const SHOWN_FIELDS = 6;
const VALUE_CHARS = 240;

function renderRecord(record: unknown): string {
  if (!record || typeof record !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (parts.length >= SHOWN_FIELDS) break;
    if (typeof value === "string" && value.trim()) {
      parts.push(`${key}: ${value.trim().slice(0, VALUE_CHARS)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join("; ");
}

function recordsOf(data: unknown, key: string | undefined): unknown[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const keyed = key ? obj[key] : undefined;
  if (Array.isArray(keyed)) return keyed;
  const first = Object.values(obj).find(Array.isArray);
  return Array.isArray(first) ? first : [];
}

/**
 * Facts from Alexandria, Firecrawl's catalogue of data providers, for a finalist whose text is
 * thin (the caller decides that with `isThinText`). Two calls: discovery (`POST /v2/search` with
 * the alexandria source, free) picks the first capability that needs only a free-text input and
 * fits the credit caps, then `POST /v2/scrape` with an `alexandria` body runs it. Records that
 * share fewer than two content words with the story title are dropped as unrelated. The block
 * names the provider and capability, so the writer cites it and the grounding check reads it as
 * part of the source text.
 */
export function createAlexandria(options: AlexandriaOptions): Alexandria {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  let spent = 0;
  let stopped = false;

  const post = async (path: string, body: unknown, signal: AbortSignal): Promise<unknown> => {
    const response = await fetchImpl(`${FIRECRAWL_BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 429) {
      stopped = true;
      options.guard?.noteRateLimited();
      await response.body?.cancel();
      throw new Error("rate limited");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`status ${response.status}`);
    }
    return response.json();
  };

  const run = async (title: string, signal: AbortSignal): Promise<string | null> => {
    const discovery = await post(
      "/v2/search",
      { query: title, sources: ["alexandria"], toolDetail: "full", limit: 5 },
      signal,
    );
    const pick = parseTools(discovery)
      .map((tool) => ({ tool, request: optionsFor(tool, title, config.max_records) }))
      .find(({ tool, request }) => {
        if (!request) return false;
        const price = statedCredits(tool.description) ?? config.story_credit_cap;
        return price <= config.story_credit_cap && spent + price <= config.run_credit_cap;
      });
    if (!pick?.request) return null;
    const { tool, request } = pick;
    const estimate = statedCredits(tool.description) ?? config.story_credit_cap;
    // Reserved before the request, so stories extracted side by side cannot overspend together.
    spent += estimate;
    let reply: unknown;
    try {
      reply = await post(
        "/v2/scrape",
        {
          alexandria: [{ provider: tool.provider, capability: tool.capability, options: request }],
        },
        signal,
      );
    } catch (error) {
      // A request that failed or timed out may still have billed; the estimate stays counted.
      options.onCredits?.(estimate, true);
      throw error;
    }
    const data = (reply as { data?: { alexandria?: unknown[]; creditsCost?: unknown } }).data;
    const measured = typeof data?.creditsCost === "number" ? data.creditsCost : null;
    spent += (measured ?? estimate) - estimate;
    options.onCredits?.(measured ?? estimate, measured === null);
    const result = data?.alexandria?.[0] as { data?: unknown; error?: unknown } | undefined;
    if (!result || result.error) return null;

    const wanted = new Set(contentTokens(title));
    const lines = recordsOf(result.data, tool.responseKey)
      .slice(0, config.max_records)
      .filter((record) => {
        const shared = contentTokens(renderRecord(record)).filter((t) => wanted.has(t));
        return new Set(shared).size >= 2;
      })
      .map(renderRecord)
      .filter(Boolean);
    if (lines.length === 0) return null;
    const head = `Alexandria facts (provider ${tool.provider}, capability ${tool.capability}). Sourced records from a data provider, not from the article; attribute any fact used to ${tool.provider}.`;
    return `${head}\n${lines.map((line) => `- ${line}`).join("\n")}`.slice(0, config.max_chars);
  };

  return {
    get spent() {
      return spent;
    },
    async factsFor(item) {
      if (!config.enabled || stopped || options.guard?.stopped) return null;
      if (spent >= config.run_credit_cap) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeout_ms);
      try {
        return await run(item.title, controller.signal);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
