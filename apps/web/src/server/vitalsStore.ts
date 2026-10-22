import { type VitalSample, VITALS_DAY_MAX_SAMPLES, VitalsDay, vitalsPath } from "@dispatch/core";
import { type NarrateBlobStore, readFresh } from "./blobStore";

/**
 * Where /api/report keeps real-user Web Vitals: one public Blob file per UTC day
 * (health/vitals-YYYY-MM-DD.json), which `dispatch health` reads by URL. A put is an ADVANCED
 * operation (2,000 a month, shared with narration; blobStore.ts), so an instance writes at most
 * once every VITALS_FLUSH_MS and VITALS_FLUSHES_PER_DAY times a day, holds what arrives meanwhile
 * for its next write, and stops for the day once the file is full. Two instances writing in the
 * same moment can lose one batch: these are samples, not records.
 */

export const VITALS_FLUSH_MS = 15 * 60_000;
export const VITALS_FLUSHES_PER_DAY = 24;

export interface VitalsBuffer {
  pending: VitalSample[];
  lastFlush: number;
  day: string;
  flushes: number;
  /** The day whose file is full: nothing more is kept or written for it. */
  fullDay: string | null;
}

export function newVitalsBuffer(): VitalsBuffer {
  return { pending: [], lastFlush: Number.NEGATIVE_INFINITY, day: "", flushes: 0, fullDay: null };
}

export interface VitalsDeps {
  /** The store, or null when the site has no Blob credentials (the sample is dropped). */
  openBlob: () => NarrateBlobStore | null;
  now: () => number;
  log: (line: string) => void;
}

export async function recordVital(
  sample: VitalSample,
  buffer: VitalsBuffer,
  deps: VitalsDeps,
): Promise<void> {
  const now = deps.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (buffer.fullDay === day) return;
  if (buffer.pending.length < VITALS_DAY_MAX_SAMPLES) buffer.pending.push(sample);
  if (buffer.day !== day) {
    buffer.day = day;
    buffer.flushes = 0;
  }
  if (now - buffer.lastFlush < VITALS_FLUSH_MS || buffer.flushes >= VITALS_FLUSHES_PER_DAY) return;
  const blob = deps.openBlob();
  if (blob === null) {
    buffer.pending = [];
    return;
  }
  // Taken before the first await, so a second request in the meantime holds its sample instead.
  buffer.lastFlush = now;
  buffer.flushes += 1;
  const batch = buffer.pending;
  buffer.pending = [];
  try {
    const path = vitalsPath(day);
    const stored = await readFresh(blob, path);
    const parsed = stored ? VitalsDay.safeParse(JSON.parse(stored.text)) : null;
    const kept = parsed?.success ? parsed.data.samples : [];
    if (kept.length >= VITALS_DAY_MAX_SAMPLES) {
      buffer.fullDay = day;
      return;
    }
    const samples = [...kept, ...batch].slice(0, VITALS_DAY_MAX_SAMPLES);
    const file: VitalsDay = { version: 1, day, samples };
    await blob.put(path, JSON.stringify(file), {
      contentType: "application/json",
      cacheSeconds: 60,
    });
    if (samples.length >= VITALS_DAY_MAX_SAMPLES) buffer.fullDay = day;
  } catch (error) {
    deps.log(`[client-vitals] not stored: ${error instanceof Error ? error.name : "error"}`);
  }
}
