import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CostKind, STATE_FILES, UsageFile } from "@singularity/core";
import { recordPaidCalls } from "../cost/ledger.js";
import { loadScheduleZone } from "../schedule/store.js";
import { writeJsonAtomic } from "./atomicFile.js";
import { addUsage, emptyUsage, rollOver, usageMonth } from "./budgetMath.js";
import type { UsageStore } from "./usageStore.js";

// The rules live in budgetMath.ts, which the site's narrate function also imports. This file adds
// the engine's storage for them: the Blob document the site shares (usageBlob.ts), or
// state/usage.json when there is no Blob store.
export * from "./budgetMath.js";
export type { UsageStore } from "./usageStore.js";

export async function loadUsage(root: string, now: Date): Promise<UsageFile> {
  const month = usageMonth(now);
  let text: string;
  try {
    text = await readFile(join(root, STATE_FILES.usage), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyUsage(month);
    throw error;
  }
  const parsed = UsageFile.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(`${STATE_FILES.usage} is not valid: ${parsed.error.message}`);
  return rollOver(parsed.data, month);
}

export async function saveUsage(root: string, usage: UsageFile): Promise<void> {
  await writeJsonAtomic(join(root, STATE_FILES.usage), UsageFile.parse(usage));
}

/** The count in state/usage.json: for tests and a machine with no Blob store (D339). */
export function fileUsageStore(root: string): UsageStore {
  return {
    load: (now) => loadUsage(root, now),
    async add(now, characters) {
      const next = addUsage(await loadUsage(root, now), now, characters);
      await saveUsage(root, next);
      return next;
    },
  };
}

export interface RecordUsageInput {
  root: string;
  /** Where the count lives. Without it, state/usage.json under `root`. */
  store?: UsageStore;
  now: Date;
  characters: number;
  /** Also records the characters in the cost ledger, for this run and kind. */
  ledger?: { runId: string; kind: CostKind; product: string; user?: string };
}

/** Add billed characters to the month's count (the Blob document the site shares, or state/usage.json). */
export async function recordUsage(input: RecordUsageInput): Promise<UsageFile> {
  const next = await (input.store ?? fileUsageStore(input.root)).add(input.now, input.characters);
  if (input.ledger && input.characters > 0) {
    try {
      await recordPaidCalls(input.root, [
        {
          at: input.now.toISOString(),
          runId: input.ledger.runId,
          kind: input.ledger.kind,
          timezone: await loadScheduleZone(input.root),
          user: input.ledger.user,
          stage: "narration",
          provider: "speechify",
          product: input.ledger.product,
          units: { characters: input.characters },
          // Each recording is its own billing: usage.json adds it every time, so the ledger must too.
          event: randomUUID(),
        },
      ]);
    } catch {
      // The ledger is a convenience; the character count above is what enforces the budget.
    }
  }
  return next;
}
