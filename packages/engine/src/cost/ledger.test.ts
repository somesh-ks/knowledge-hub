import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callsFromSpend, loadAllCosts, recordPaidCalls } from "./ledger.js";

const base = {
  at: "2026-10-20T05:13:00.000Z",
  runId: "2026-10-20T05:00:00.000Z",
  kind: "daily" as const,
  timezone: "Europe/Stockholm",
};

describe("cost ledger", () => {
  it("prices a run's measured tokens and requests, marking counted credits as estimated", () => {
    const calls = callsFromSpend(
      {
        requests: { jev: 40, exa: 3, firecrawl_listing: 10, firecrawl_scrape: 5, nebius: 7 },
        units: {
          "anthropic|claude-sonnet-5-5|input_tokens": 100_000,
          "anthropic|claude-sonnet-5-5|output_tokens": 20_000,
        },
      },
      base,
    );
    const byProvider = Object.fromEntries(calls.map((call) => [call.provider, call]));
    expect(byProvider.anthropic?.units).toEqual({ input_tokens: 100_000, output_tokens: 20_000 });
    expect(byProvider.anthropic?.estimated).toBeUndefined();
    expect(byProvider.firecrawl?.units).toEqual({ credits: 15 });
    expect(byProvider.firecrawl?.estimated).toBe(true);
    // Request counts of the token providers are not billed twice.
    expect(calls.some((call) => call.provider === "nebius")).toBe(false);
  });

  it("keeps one record per run and product when the commit stage is run again", async () => {
    const root = await mkdtemp(join(tmpdir(), "costs-"));
    const prices = {
      version: 1 as const,
      as_of: "2026-10-21",
      prices: [
        {
          provider: "speechify",
          product: "*",
          units: { characters: { usd: 10, per: 1_000_000 } },
          as_of: "2026-10-21",
          confirmed: false,
        },
      ],
    };
    const call = {
      ...base,
      stage: "narration",
      provider: "speechify",
      product: "simba-3.2",
      units: { characters: 50_000 },
    };
    await recordPaidCalls(root, [call], prices);
    await recordPaidCalls(root, [call], prices);
    const all = await loadAllCosts(root);
    expect(all).toHaveLength(1);
    expect(all[0]?.usd).toBeCloseTo(0.5, 10);
    expect(
      JSON.parse(await readFile(join(root, "state", "costs-2026-10.json"), "utf8")).version,
    ).toBe(1);
  });
});
