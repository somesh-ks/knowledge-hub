import { type VitalSample, VitalsDay, vitalsPath } from "@dispatch/core";
import { type NarrateBlobStore, readFresh } from "./blobStore";

/**
 * Where /api/report keeps real-user Web Vitals: one public Blob file per UTC day
 * (health/vitals-YYYY-MM-DD.json), which `dispatch health` reads by URL. Each accepted sample is
 * written when it arrives, so a quiet site loses none to an instance that never writes again.
 *
 * A put is an ADVANCED operation (2,000 a month, shared with narration; blobStore.ts). The cap is
 * global because it is read from the day's file itself: once the file holds VITALS_DAY_CAP samples
 * every instance stops writing for the day, and remembers so it stops reading too. scripts/vitals.ts
 * sends from half of all page views, so the cap fills across the day instead of in its first hour.
 * Worst case: 20 puts a day, 620 in a 31-day month, under a third of the budget, and 2 SIMPLE
 * operations (of 10,000) per write. Two instances writing in the same moment can lose a sample and
 * spend a put on it; an instance writes at most VITALS_DAY_CAP times a day, so even that stays
 * bounded. These are samples, not records.
 */

export const VITALS_DAY_CAP = 20;

/** What one instance remembers between requests: the writes it spent today, and a full day. */
export interface VitalsMemo {
  day: string;
  writes: number;
  /** The day whose file is full: nothing more is read or written for it. */
  fullDay: string | null;
}

export function newVitalsMemo(): VitalsMemo {
  return { day: "", writes: 0, fullDay: null };
}

export interface VitalsDeps {
  /** The store, or null when the site has no Blob credentials (the sample is dropped). */
  openBlob: () => NarrateBlobStore | null;
  now: () => number;
  log: (line: string) => void;
}

export async function recordVital(
  sample: VitalSample,
  memo: VitalsMemo,
  deps: VitalsDeps,
): Promise<void> {
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  if (memo.day !== day) {
    memo.day = day;
    memo.writes = 0;
  }
  if (memo.fullDay === day || memo.writes >= VITALS_DAY_CAP) return;
  const blob = deps.openBlob();
  if (blob === null) return;
  // Counted before the first await, so a burst of requests cannot pass the cap together.
  memo.writes += 1;
  try {
    const path = vitalsPath(day);
    const stored = await readFresh(blob, path);
    const parsed = stored ? VitalsDay.safeParse(JSON.parse(stored.text)) : null;
    const kept = parsed?.success ? parsed.data.samples : [];
    if (kept.length >= VITALS_DAY_CAP) {
      memo.fullDay = day;
      return;
    }
    const file: VitalsDay = { version: 1, day, samples: [...kept, sample] };
    await blob.put(path, JSON.stringify(file), {
      contentType: "application/json",
      cacheSeconds: 60,
    });
    if (file.samples.length >= VITALS_DAY_CAP) memo.fullDay = day;
  } catch (error) {
    deps.log(`[client-vitals] not stored: ${error instanceof Error ? error.name : "error"}`);
  }
}
