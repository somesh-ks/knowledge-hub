import type { VitalsReport } from "@dispatch/engine/vitals-store";
import { describe, expect, it } from "vitest";
import {
  handleReport,
  REPORTS_PER_MINUTE,
  readCapped,
  readReportBody,
  VITALS_PER_MINUTE,
} from "./report";

const limiters = () => ({
  faults: { windowStart: 0, count: 0 },
  vitals: { windowStart: 0, count: 0 },
});

describe("handleReport", () => {
  // A page stuck in an error loop must not fill the function log, and a token in a page's query
  // string (a share link, a passphrase) must never be written to it.
  it("logs a fault by its path alone and drops a flood past the per-minute cap", async () => {
    const lines: string[] = [];
    const limiter = limiters();
    let now = 1_000_000;
    const deps = { log: (line: string) => lines.push(line), now: () => now };
    const body = JSON.stringify({
      kind: "error",
      page: "/d/2026-10-20?key=secret-value",
      message: "boom",
      source: "https://news.example/_astro/app.js?v=1#x",
      line: 3,
    });
    for (let i = 0; i < REPORTS_PER_MINUTE + 5; i++) {
      expect((await handleReport(body, deps, limiter)).status).toBe(204);
    }
    expect(lines).toHaveLength(REPORTS_PER_MINUTE);
    expect(lines[0]).toContain('"page":"/d/2026-10-20"');
    expect(lines[0]).toContain('"source":"https://news.example/_astro/app.js"');
    expect(lines.join("\n")).not.toContain("secret-value");
    now += 60_000;
    await handleReport(body, deps, limiter);
    expect(lines).toHaveLength(REPORTS_PER_MINUTE + 1);
  });

  // Vitals reports spent the fault log's slots (D146), so a busy hour of page loads hid real
  // faults; and the store must keep a route template, never a page's address or anything else a
  // body carries. An old bundle's vitals shape is dropped unstored.
  it("stores a page's vitals by template alone, apart from the fault log's cap", async () => {
    const lines: string[] = [];
    const stored: VitalsReport[] = [];
    const limiter = limiters();
    const deps = {
      log: (line: string) => lines.push(line),
      now: () => 1_000_000,
      storeVitals: async (report: VitalsReport) => {
        stored.push(report);
      },
    };
    const vitals = JSON.stringify({
      kind: "vitals",
      page: "/d/2026-10-20?key=secret-value",
      device: "mobile",
      connection: "4g",
      lcp: 1800,
      cls: 0.02,
      inp: -5,
      agent: "secret-value",
    });
    for (let i = 0; i < VITALS_PER_MINUTE; i++) {
      expect((await handleReport(vitals, deps, limiter)).status).toBe(204);
    }
    await handleReport(JSON.stringify({ kind: "vitals", page: "/", metrics: [] }), deps, limiter);
    await handleReport(
      JSON.stringify({ kind: "error", page: "/", message: "boom" }),
      deps,
      limiter,
    );
    expect(lines).toHaveLength(1);
    expect(stored).toHaveLength(VITALS_PER_MINUTE);
    expect(stored[0]).toEqual({
      page: "/d/[id]",
      device: "mobile",
      connection: "4g",
      values: { lcp: 1800, cls: 0.02 },
    });
  });

  // A body past the cap must stop being read at the cap, not be buffered whole first.
  it("stops reading a body at the byte cap", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1_000));
      },
    });
    expect(await readCapped(endless, 4_096)).toBeNull();
    expect(pulled).toBeLessThan(10);
    const small = new Response('{"kind":"error"}').body;
    expect(await readCapped(small, 4_096)).toBe('{"kind":"error"}');
  });

  // A chunked or HTTP/2 report has no Content-Length and was refused with 413 though the stream is capped.
  it("reads a body with no declared length, and refuses a declared one past the cap", async () => {
    const body = () => new Response('{"kind":"error"}').body;
    expect(await readReportBody(null, body(), 4_096)).toBe('{"kind":"error"}');
    expect(await readReportBody("99999", body(), 4_096)).toBeNull();
    expect(await readReportBody("junk", body(), 4_096)).toBeNull();
  });
});
