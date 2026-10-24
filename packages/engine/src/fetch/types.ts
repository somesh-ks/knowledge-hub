import type { Item, Source } from "@singularity/core";
import type { FetchWindow } from "../gate/fetchWindow.js";
import type { HttpClient } from "../http.js";
import type { FirecrawlGuard } from "./firecrawlBudget.js";
import type { ExaQuery } from "./queries.js";

export type { FetchWindow };

/** Credentials and endpoints for the paid services. Absent keys make those sources skip. */
export interface ServiceConfig {
  apiKey?: string | undefined;
  /** Overridable so tests and proxies can point elsewhere. */
  baseUrl?: string | undefined;
}

export interface FetchDeps {
  /** All network access goes through this client, which tests replace with a fake. */
  http: HttpClient;
  now: () => Date;
  /** Deadline for the current source. Fetchers pass it to every request. */
  signal?: AbortSignal | undefined;
  exa?: (ServiceConfig & { queries: readonly ExaQuery[] }) | undefined;
  firecrawl?: (ServiceConfig & { guard?: FirecrawlGuard | undefined }) | undefined;
  /** Optional contact address for Crossref's polite pool. */
  crossrefMailto?: string | undefined;
}

export type SourceFetcher = (
  source: Source,
  window: FetchWindow,
  deps: FetchDeps,
) => Promise<Item[]>;

export interface SourceResult {
  source_id: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
  /** Why a source did nothing without failing, such as a missing API key. */
  note?: string;
  /** Read through Firecrawl because its host refused the runner (fetchAll's relay). */
  via?: "firecrawl";
}

/** Thrown by a fetcher that cannot run in this environment. Not a failure. */
export class SourceSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SourceSkipped";
  }
}
