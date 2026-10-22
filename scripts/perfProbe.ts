/**
 * The weekly lab probe (D147, Mondays: D148): cold loads of the home page, the latest briefing and the Library on a
 * throttled phone, read as LCP, CLS and TBT. `dispatch health --perf <file>` judges what it writes.
 *
 *   tsx scripts/perfProbe.ts <origin> [--out perf.json] [--loads 3] [--browser <chromium path>]
 *
 * Each load gets a fresh context with the service worker blocked, so nothing is warm; each page's
 * reading is the median of its loads. Any failure (the site down, a timeout) exits 1 and writes
 * nothing, which health reads as `perf_unmeasured`.
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { type Browser, chromium, devices } from "@playwright/test";
import {
  cumulativeLayoutShift,
  type LayoutShift,
  type LongTask,
  medianMetrics,
  type PageMetrics,
  totalBlockingTime,
} from "./perfMath.js";

/** Lighthouse's mobile CPU slowdown. */
const CPU_SLOWDOWN = 4;
/** DevTools' "Fast 4G" preset: 9 Mb/s down, 1.5 Mb/s up, 60 ms latency (times 2.75, as DevTools applies it). */
const FAST_4G = {
  offline: false,
  latency: 60 * 2.75,
  downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9,
  uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
};
/** Long tasks and shifts are read for this long after the load event. */
const IDLE_MS = 5000;
const LOAD_TIMEOUT_MS = 60_000;

/** Runs in the page before its own scripts: buffered observers for the three metrics. */
const COLLECT = `
  window.__perf = { lcp: 0, shifts: [], tasks: [] };
  const watch = (type, take) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(take)).observe({ type, buffered: true });
    } catch {}
  };
  watch("largest-contentful-paint", (entry) => { window.__perf.lcp = entry.startTime; });
  watch("layout-shift", (entry) => window.__perf.shifts.push({
    startTime: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput,
  }));
  watch("longtask", (entry) => window.__perf.tasks.push({
    startTime: entry.startTime, duration: entry.duration,
  }));
`;

interface Collected {
  lcp: number;
  shifts: LayoutShift[];
  tasks: LongTask[];
  fcp: number;
  loadEnd: number;
}

async function measure(browser: Browser, url: string): Promise<PageMetrics> {
  const context = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  try {
    await context.addInitScript({ content: COLLECT });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", FAST_4G);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
    const response = await page.goto(url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    if (!response?.ok()) throw new Error(`${url} answered ${response?.status() ?? "nothing"}`);
    await page.waitForTimeout(IDLE_MS);
    const collected = (await page.evaluate(
      `({
        ...window.__perf,
        fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
        loadEnd: performance.getEntriesByType("navigation")[0]?.loadEventEnd ?? 0,
      })`,
    )) as Collected;
    if (!(collected.lcp > 0)) throw new Error(`${url} reported no largest contentful paint`);
    return {
      lcp_ms: collected.lcp,
      cls: cumulativeLayoutShift(collected.shifts),
      tbt_ms: totalBlockingTime(collected.tasks, collected.fcp, collected.loadEnd + IDLE_MS),
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", default: "perf.json" },
      loads: { type: "string", default: "3" },
      browser: { type: "string" },
    },
  });
  const origin = positionals[0]?.replace(/\/+$/, "");
  const loads = Number(values.loads);
  if (!origin || !/^https?:\/\/[^/]+$/.test(origin) || !Number.isInteger(loads) || loads < 1) {
    throw new Error(
      "Usage: tsx scripts/perfProbe.ts <origin> [--out perf.json] [--loads 3] [--browser <path>]",
    );
  }
  const answer = await fetch(`${origin}/latest.json`, { signal: AbortSignal.timeout(20_000) });
  if (!answer.ok) throw new Error(`/latest.json answered ${answer.status}`);
  const latest = (await answer.json()) as { id?: string | null };
  if (!latest.id) throw new Error("/latest.json names no briefing");
  const paths = ["/", `/d/${latest.id}`, "/library"];

  const browser = await chromium.launch(values.browser ? { executablePath: values.browser } : {});
  try {
    const pages = [];
    for (const path of paths) {
      const runs: PageMetrics[] = [];
      for (let load = 0; load < loads; load += 1)
        runs.push(await measure(browser, `${origin}${path}`));
      const { lcp_ms, cls, tbt_ms } = medianMetrics(runs);
      pages.push({
        page: path,
        lcp_ms: Math.round(lcp_ms),
        cls: Number(cls.toFixed(4)),
        tbt_ms: Math.round(tbt_ms),
      });
    }
    const report = {
      version: 1,
      origin,
      measured_at: new Date().toISOString(),
      loads,
      throttling: { cpu_slowdown: CPU_SLOWDOWN, network: "fast-4g", device: "Pixel 7" },
      pages,
    };
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(pages)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`perf probe: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
