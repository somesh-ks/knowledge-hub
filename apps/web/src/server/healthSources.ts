import {
  type Digest,
  LastRunFile,
  parseDigestFile,
  ScheduleFile,
  SourceHealthFile,
} from "@singularity/core";
import { type ClientFaultGroup, readClientFaults } from "@singularity/engine/faults-store";
import { readVitals, type VitalSummary } from "@singularity/engine/vitals-store";
import type { HealthBody } from "../lib/healthRows";
import { HEALTH_JOBS } from "../lib/healthRows";
import { readServerConfig } from "./config";
import { contentDigestIds, contentDigests, contentStateFile } from "./contentSources";
import { guardedDatabase } from "./database";
import { createGitHubClient } from "./github";
import { HEALTH_WINDOW_DAYS, type HealthInput, healthBody, UNAVAILABLE } from "./health";

/**
 * Gathers what the Health page judges (health.ts), each part at once and each within PART_TIMEOUT_MS,
 * so one slow upstream marks its rows unavailable and the rest still answer. The last answer is kept
 * per instance for FRESH_MS: the page is opened by one person and every part is a network read.
 */

const PART_TIMEOUT_MS = 4_000;
const FRESH_MS = 20_000;
/** Enough briefings for ten of each kind's run times. */
const DIGESTS_READ = 14;

const log = (message: string): void => console.error(`[api/health] ${message}`);

async function within<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      log(`${label}: no answer in ${PART_TIMEOUT_MS} ms`);
      resolve(fallback);
    }, PART_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      work().catch((error: unknown) => {
        log(`${label}: ${error instanceof Error ? error.message : "unreadable"}`);
        return fallback;
      }),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const parseJson = <T>(
  text: string | null,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): T | null => {
  if (text === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as T) : null;
  } catch {
    return null;
  }
};

async function readDigests(): Promise<Digest[]> {
  const source = contentDigests();
  const ids = (await contentDigestIds()).slice(0, DIGESTS_READ);
  const texts = await Promise.all(ids.map((id) => source.readDigest(id)));
  return texts.flatMap((text) => {
    if (!text) return [];
    try {
      return [parseDigestFile(text)];
    } catch {
      return [];
    }
  });
}

type Store = { vitals: readonly VitalSummary[]; faults: readonly ClientFaultGroup[] | null };

const database = guardedDatabase({
  databaseUrl: process.env.DATABASE_URL,
  timeoutMs: PART_TIMEOUT_MS,
  log: (message) => log(`store ${message}`),
});

async function readStore(now: number): Promise<Store | typeof UNAVAILABLE | "off"> {
  if (!process.env.DATABASE_URL) return "off";
  return database<Store | typeof UNAVAILABLE>(
    async (sql) => ({
      vitals: await readVitals(sql, now),
      faults: await readClientFaults(sql, now),
    }),
    UNAVAILABLE,
  );
}

async function readJobs(now: Date): Promise<HealthInput["jobs"]> {
  const config = readServerConfig(process.env);
  if (!config) return "off";
  const github = createGitHubClient(config, fetch);
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const files = Object.values(HEALTH_JOBS);
  // Each workflow apart: one GitHub error leaves its own row unavailable, not every row.
  const lists = await Promise.allSettled(files.map((file) => github.listRecentRuns(file, since)));
  const read = files.flatMap((file, index) => {
    const list = lists[index];
    if (list?.status === "fulfilled") return [[file, list.value] as const];
    log(`github ${file}: ${list?.reason instanceof Error ? list.reason.message : "unreadable"}`);
    return [];
  });
  return read.length === 0 ? UNAVAILABLE : Object.fromEntries(read);
}

export async function buildHealth(now: Date): Promise<HealthBody> {
  const [lastRun, sourceHealth, schedule, digests, store, jobs] = await Promise.all([
    within("last-run", () => contentStateFile("state/last-run.json"), {
      text: null,
      stored: false,
    }),
    within("source-health", () => contentStateFile("state/source-health.json"), {
      text: null,
      stored: false,
    }),
    within("schedule", async () => contentDigests().readSchedule?.() ?? null, null as unknown),
    within("digests", readDigests, [] as Digest[]),
    within(
      "store",
      () => readStore(now.getTime()),
      UNAVAILABLE as Store | typeof UNAVAILABLE | "off",
    ),
    within("github", () => readJobs(now), UNAVAILABLE as HealthInput["jobs"]),
  ]);
  const parsedSchedule = ScheduleFile.safeParse(schedule);
  return healthBody(
    {
      lastRun: parseJson(lastRun.text, LastRunFile),
      sourceHealth: parseJson(sourceHealth.text, SourceHealthFile),
      schedule: parsedSchedule.success ? parsedSchedule.data : null,
      stored: lastRun.stored,
      digests,
      vitals: typeof store === "string" ? store : store.vitals,
      faults: typeof store === "string" ? store : store.faults,
      jobs,
    },
    now,
  );
}

let held: { at: number; body: HealthBody } | null = null;
let building: Promise<HealthBody> | null = null;

/** Forget the held answer. For tests. */
export function resetHealthCache(): void {
  held = null;
  building = null;
}

/**
 * The held answer while it is fresh, else a new one. Requests that miss together share one build,
 * so a burst under the rate cap reads the content store, Neon and GitHub once, not once each.
 */
export async function serveHealth(now: Date): Promise<HealthBody> {
  if (held && now.getTime() - held.at < FRESH_MS) return held.body;
  building ??= buildHealth(now)
    .then((body) => {
      held = { at: now.getTime(), body };
      return body;
    })
    .finally(() => {
      building = null;
    });
  return building;
}
