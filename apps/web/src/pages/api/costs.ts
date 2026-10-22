import { type CostRecord, dateInZone, TIME_ZONE } from "@dispatch/core";
import { del, head, put } from "@vercel/blob";
import type { APIRoute } from "astro";
import { createVercelBlobStore, readFresh } from "../../server/blobStore";
import { readBlobCredentials } from "../../server/config";
import { bundledCostRecords, bundledPrices } from "../../server/costSource";
import { costBody, narrationRecords, parseCostQuery } from "../../server/costs";
import { recordingFaults, toResponse } from "../../server/http";
import { parseState, usageKey } from "../../server/narrationState";
import { sharedLimit } from "../../server/rateLimit";

// Runs on demand: the report reads the narrate function's usage documents from Blob.
export const prerender = false;

// The route is open on purpose (the owner's passphrase is off site-wide, D41) and each answer reads
// Blob, so the site answers at most this many a minute across instances; past it the answer is 429.
const REPORTS_PER_MINUTE = 30;

const OIDC_HEADER = "x-vercel-oidc-token";
const log = (message: string): void => console.error(`[api/costs] ${message}`);

/** The Play narration records of the months a window of `days` days touches. */
async function siteRecords(
  request: Request,
  days: number,
  now: Date,
  prices: NonNullable<ReturnType<typeof bundledPrices>>,
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

const get: APIRoute = async ({ request, url }) => {
  if (!(await sharedLimit("costs", REPORTS_PER_MINUTE))) {
    return toResponse({
      status: 429,
      body: { error: "rate_limited" },
      headers: { "Retry-After": "60" },
    });
  }
  const query = parseCostQuery(url.searchParams);
  const prices = bundledPrices();
  if (!query || !prices) {
    return toResponse({
      status: query ? 503 : 400,
      body: { error: query ? "unavailable" : "invalid_request" },
    });
  }
  const now = new Date();
  const site = await siteRecords(request, query.days, now, prices);
  return toResponse({
    status: 200,
    body: {
      ...costBody(query, { engine: bundledCostRecords(), site: site ?? [], prices, now }),
      site: site ? "ok" : "unavailable",
    },
  });
};

export const GET = recordingFaults("api/costs", get);

export const ALL: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
