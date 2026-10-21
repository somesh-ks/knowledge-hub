import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CostKind, STATE_FILES, UsageFile } from "@dispatch/core";
import { recordPaidCalls } from "../cost/ledger.js";
import { loadScheduleZone } from "../schedule/store.js";
import { writeJsonAtomic } from "./atomicFile.js";
import { addUsage, emptyUsage, rollOver, usageMonth } from "./budgetMath.js";

// The rules live in budgetMath.ts, which the site's narrate function also imports. This file adds
// the engine's storage for them: state/usage.json in the repository.
export * from "./budgetMath.js";

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

export interface RecordUsageInput {
  root: string;
  now: Date;
  characters: number;
  /** Also records the characters in the cost ledger, for this run and kind. */
  ledger?: { runId: string; kind: CostKind; product: string; user?: string };
}

/** Add billed characters to state/usage.json. Committed by `publish`, so it survives between runs. */
export async function recordUsage(input: RecordUsageInput): Promise<UsageFile> {
  const current = await loadUsage(input.root, input.now);
  const next = addUsage(current, input.now, input.characters);
  await saveUsage(input.root, next);
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
        },
      ]);
    } catch {
      // The ledger is a convenience; the character count above is what enforces the budget.
    }
  }
  return next;
}
