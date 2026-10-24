import { type CostRecord, dateInZone, type PriceTable, TIME_ZONE } from "@singularity/core";
import { del, head, put } from "@vercel/blob";
import type { APIRoute } from "astro";
import { anthropicBilledDays, outsideAppRecords } from "../../server/anthropicBilling";
import { createVercelBlobStore, readFresh } from "../../server/blobStore";
import { readBlobCredentials } from "../../server/config";
import { contentCostRecords, contentPrices } from "../../server/contentSources";
import { costBody, narrationRecords, parseCostQuery } from "../../server/costs";
import { recordingFaults, toResponse } from "../../server/http";
import { parseState, usageKey } from "../../server/narrationState";
import { sharedLimit } from "../../server/rateLimit";

// Runs on demand: the report reads the engine's ledger from the content repository, the narrate
// function's usage documents from Blob and, with an Admin key, Anthropic's cost report.
export const prerender = false;

// The route is open on purpose (the site has no passphrase, D160) and each answer reads
// Blob, so the site answers at most this many a minute across instances; past it the answer is 429.
const REPORTS_PER_MINUTE = 30;

const OIDC_HEADER = "x-vercel-oidc-token";
const log = (message: string): void => console.error(`[api/costs] ${message}`);

/** The Play narration records of the months a window of `days` days touches. */
async function siteRecords(
  request: Request,
  days: number,
  now: Date,
  prices: PriceTable,
): Promise<CostRecord[] | null> {
  const credentials = readBlobCredentials(process.env, () => request.headers.get(OIDC_HEADER));
  if (!credentials) return null;
  const store = createVercelBlobStore(credentials, { head, put, del }, fetch);
  const months = new Set<string>();
  for (let day = 0; day < days; day += 28) {
    const at = new Date(now.getTime() - day * 86_400_000).toISOString();
    months.add(dateInZone(at, TIME_ZONE).slice(0, 7));
  }
  months.add(
    dateInZone(new Date(now.getTime() - (days - 1) * 86_400_000).toISOString(), TIME_ZONE).slice(
      0,
      7,
    ),
  );
  try {
    const documents = await Promise.all(
      [...months].map(async (month) => {
        const stored = await readFresh(store, usageKey(month));
        return stored ? narrationRecords(parseState(stored.text, month), prices) : [];
      }),
    );
    return documents.flat();
  } catch (error) {
    log(`usage: ${error instanceof Error ? error.message : "unreadable"}`);
    return null;
  }
}

/** Anthropic's bill beyond the ledger; "off" without an Admin key, null records when unreadable. */
async function billingRecords(
  days: number,
  now: Date,
  engine: CostRecord[],
): Promise<{ state: "ok" | "unavailable" | "off"; records: CostRecord[] }> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!adminKey) return { state: "off", records: [] };
  // The report is by UTC day; a day more than the window covers its first local day.
  const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  try {
    const billed = await anthropicBilledDays(adminKey, from, to);
    return { state: "ok", records: outsideAppRecords(billed, engine) };
  } catch (error) {
    log(`billing: ${error instanceof Error ? error.message : "unreadable"}`);
    return { state: "unavailable", records: [] };
  }
}

const get: APIRoute = async ({ request, url }) => {
  if (!(await sharedLimit("costs", REPORTS_PER_MINUTE))) {
    return toResponse({
      status: 429,
      body: { error: "rate_limited" },
      headers: { "Retry-After": "60" },
    });
  }
  const query = parseCostQuery(url.searchParams);
  const prices = await contentPrices();
  if (!query || !prices) {
    return toResponse({
      status: query ? 503 : 400,
      body: { error: query ? "unavailable" : "invalid_request" },
    });
  }
  const now = new Date();
  const [site, engine] = await Promise.all([
    siteRecords(request, query.days, now, prices),
    contentCostRecords(),
  ]);
  const billing = await billingRecords(query.days, now, engine);
  return toResponse({
    status: 200,
    body: {
      ...costBody(query, { engine, site: [...(site ?? []), ...billing.records], prices, now }),
      site: site ? "ok" : "unavailable",
      billing: billing.state,
    },
  });
};

export const GET = recordingFaults("api/costs", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
