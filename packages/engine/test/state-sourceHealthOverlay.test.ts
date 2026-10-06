import type { Source, SourcesFile } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { applySourceResults, overlayHealth, toHealthFile } from "../src/state/sourceHealth.js";

const source = (id: string, over: Partial<Source> = {}): Source => ({
  id,
  name: id,
  type: "rss",
  url: `https://${id}.example.com`,
  feed_url: `https://${id}.example.com/feed`,
  tier: "daily",
  high_signal: false,
  enabled: true,
  failures: 0,
  options: {},
  ...over,
});

const registry: SourcesFile = { version: 1, sources: [source("a"), source("b")] };

describe("source health overlay", () => {
  it("overlays stored failures and last success onto the registry", () => {
    const merged = overlayHealth(registry, {
      version: 1,
      sources: { a: { failures: 3, last_ok: "2026-10-01T05:13:00.000Z" } },
    });
    expect(merged.sources[0]?.failures).toBe(3);
    expect(merged.sources[0]?.last_ok).toBe("2026-10-01T05:13:00.000Z");
    expect(merged.sources[1]?.failures).toBe(0);
  });

  it("round-trips through toHealthFile and omits healthy untouched sources", () => {
    const after = applySourceResults(
      registry,
      [
        { source_id: "a", ok: false, count: 0, ms: 5, error: "boom" },
        { source_id: "b", ok: true, count: 4, ms: 5 },
      ],
      new Date("2026-10-07T05:13:00Z"),
    );
    const stored = toHealthFile(after);
    expect(stored.sources.a?.failures).toBe(1);
    expect(stored.sources.b?.failures).toBe(0);
    expect(stored.sources.b?.last_ok).toBe("2026-10-07T05:13:00.000Z");
    expect(toHealthFile(registry).sources).toEqual({});
  });
});
