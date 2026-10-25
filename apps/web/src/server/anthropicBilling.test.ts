import type { CostRecord } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { anthropicBilledDays, outsideAppRecords, resetBillingCache } from "./anthropicBilling";

const run = (at: string, usd: number): CostRecord => ({
  id: `run|${at}`,
  at,
  run_id: at,
  kind: "daily",
  timezone: "Europe/Stockholm",
  user: "owner",
  scope: "shared",
  stage: "write",
  provider: "anthropic",
  product: "claude-sonnet-5-5",
  units: { input_tokens: 1 },
  usd,
});

describe("Anthropic's bill on the Costs page", () => {
  it("adds only what was billed beyond the ledger, across report pages, so a run is not counted twice", async () => {
    resetBillingCache();
    const pages = [
      {
        data: [{ starting_at: "2026-10-23T00:00:00Z", results: [{ amount: "50" }] }],
        has_more: true,
        next_page: "p2",
      },
      {
        data: [
          {
            starting_at: "2026-10-24T00:00:00Z",
            results: [{ amount: "400" }, { amount: "126.2" }],
          },
        ],
        has_more: false,
      },
    ];
    const asked: string[] = [];
    const fetchFn = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(pages[asked.length - 1]));
    }) as unknown as typeof fetch;
    const billed = await anthropicBilledDays("key", "2026-10-23", "2026-10-24", fetchFn, 0);
    expect(asked[1]).toContain("page=p2");
    // 23 Oct: $0.50 billed, $0.60 recorded (the ledger prices cache reads in full): nothing outside.
    // 24 Oct: $5.262 billed, $1.089 + $1.173 recorded: $3.00 outside the app.
    const records = outsideAppRecords(billed, [
      run("2026-10-23T05:00:00.000Z", 0.6),
      run("2026-10-24T05:37:00.000Z", 1.089),
      run("2026-10-24T12:49:00.000Z", 1.173),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: "outside_app", at: "2026-10-24T12:00:00.000Z" });
    expect(records[0]?.usd).toBeCloseTo(3, 6);
  });
});
