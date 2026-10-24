import { CostFile, type CostRecord, PriceTable } from "@singularity/core";

/**
 * The ledger the engine commits, as this build holds it: Vite compiles state/costs-*.json and
 * config/prices.json into the server build, like the digests (see digestSource.ts). A new ledger
 * commit redeploys the site, so the report is at most one deploy behind.
 */
const costFiles = import.meta.glob<unknown>("../../../../state/costs-*.json", {
  import: "default",
  eager: true,
});
const priceFile = import.meta.glob<unknown>("../../../../config/prices.json", {
  import: "default",
  eager: true,
});

export function bundledCostRecords(): CostRecord[] {
  return Object.values(costFiles).flatMap((file) => {
    const parsed = CostFile.safeParse(file);
    return parsed.success ? parsed.data.records : [];
  });
}

export function bundledPrices(): PriceTable | null {
  const parsed = PriceTable.safeParse(Object.values(priceFile)[0]);
  return parsed.success ? parsed.data : null;
}
